"""TOML config loader for Core.

Layers, highest precedence wins:
  1. CLI flag (e.g. ``--host``)
  2. Environment variable (e.g. ``MESH_HOST``)
  3. TOML config file (``mesh.toml``)
  4. Built-in default

Secrets — ``ADMIN_TOKEN`` and per-node ``identity_secret`` — are NEVER read
here. They stay env-var-only and are resolved at the call site.

Per-mesh: one TOML per mesh, alongside the manifest yaml. The schema is
operator-facing only; nothing in here describes node behaviour.
"""
from __future__ import annotations

import argparse
import logging
import os
import pathlib
import tomllib
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Optional

_log = logging.getLogger("mesh.config")

# Replay-window bounds — enforced in code, NOT operator-tunable.
REPLAY_WINDOW_MIN_S = 5
REPLAY_WINDOW_MAX_S = 300
REPLAY_WINDOW_DEFAULT_S = 60


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8000
    manifest_path: Optional[str] = None
    invoke_timeout_s: int = 30


@dataclass
class AdminConfig:
    rate_limit: float = 60.0
    rate_burst: float = 20.0


@dataclass
class SecurityConfig:
    replay_window_s: int = REPLAY_WINDOW_DEFAULT_S


@dataclass
class SupervisorConfig:
    enabled: bool = False
    log_dir: str = ".logs"
    auto_reconcile: bool = False


@dataclass
class LoggingConfig:
    audit_log_path: str = "audit.log"


@dataclass
class Config:
    server: ServerConfig = field(default_factory=ServerConfig)
    admin: AdminConfig = field(default_factory=AdminConfig)
    security: SecurityConfig = field(default_factory=SecurityConfig)
    supervisor: SupervisorConfig = field(default_factory=SupervisorConfig)
    logging: LoggingConfig = field(default_factory=LoggingConfig)
    sources: dict[str, str] = field(default_factory=dict)
    toml_path: Optional[str] = None


_SCHEMA: dict[str, dict[str, tuple[type, ...]]] = {
    "server": {
        "host": (str,),
        "port": (int,),
        "manifest_path": (str,),
        "invoke_timeout_s": (int, float),
    },
    "admin": {
        "rate_limit": (int, float),
        "rate_burst": (int, float),
    },
    "security": {
        "replay_window_s": (int,),
    },
    "supervisor": {
        "enabled": (bool,),
        "log_dir": (str,),
        "auto_reconcile": (bool,),
    },
    "logging": {
        "audit_log_path": (str,),
    },
}


def _env_bool(s: str) -> bool:
    # Preserve legacy semantics: only "1" is True.
    return s == "1"


_ENV_MAPPINGS: list[tuple[str, str, str, Callable[[str], Any]]] = [
    ("MESH_HOST", "server", "host", str),
    ("MESH_PORT", "server", "port", int),
    ("MESH_MANIFEST", "server", "manifest_path", str),
    ("MESH_INVOKE_TIMEOUT", "server", "invoke_timeout_s", int),
    ("MESH_ADMIN_RATE_LIMIT", "admin", "rate_limit", float),
    ("MESH_ADMIN_RATE_BURST", "admin", "rate_burst", float),
    ("MESH_REPLAY_WINDOW_S", "security", "replay_window_s", int),
    ("MESH_SUPERVISOR", "supervisor", "enabled", _env_bool),
    ("MESH_SUPERVISOR_LOG_DIR", "supervisor", "log_dir", str),
    ("MESH_AUTO_RECONCILE", "supervisor", "auto_reconcile", _env_bool),
    ("AUDIT_LOG", "logging", "audit_log_path", str),
]


_CLI_MAPPINGS: list[tuple[str, str, str, str]] = [
    ("manifest", "server", "manifest_path", "--manifest"),
    ("host", "server", "host", "--host"),
    ("port", "server", "port", "--port"),
    ("audit_log", "logging", "audit_log_path", "--audit-log"),
    ("supervisor", "supervisor", "enabled", "--supervisor"),
    ("supervisor_log_dir", "supervisor", "log_dir", "--supervisor-log-dir"),
    ("auto_reconcile", "supervisor", "auto_reconcile", "--auto-reconcile"),
]


def _set_field(config: Config, section: str, field_name: str,
               value: Any, source: str) -> None:
    setattr(getattr(config, section), field_name, value)
    config.sources[f"{section}.{field_name}"] = source


def _validate_replay_window(val: int, *, source: str) -> int:
    if val < REPLAY_WINDOW_MIN_S:
        _log.warning(
            "replay_window_s=%d (from %s) below floor; clamped to %ds",
            val, source, REPLAY_WINDOW_MIN_S,
        )
        return REPLAY_WINDOW_MIN_S
    if val > REPLAY_WINDOW_MAX_S:
        _log.warning(
            "replay_window_s=%d (from %s) above ceiling; clamped to %ds",
            val, source, REPLAY_WINDOW_MAX_S,
        )
        return REPLAY_WINDOW_MAX_S
    return val


def _check_type(value: Any, accepted: tuple[type, ...]) -> bool:
    # bool is an int subclass — exclude when only int is accepted.
    if bool not in accepted and isinstance(value, bool):
        return False
    return isinstance(value, accepted)


def _apply_toml(config: Config, parsed: dict, source_label: str) -> None:
    if not isinstance(parsed, dict):
        _log.warning("config TOML root is not a table; ignoring")
        return
    for section_name, section_data in parsed.items():
        if section_name not in _SCHEMA:
            _log.warning(
                "unknown section [%s] in %s; ignoring",
                section_name, source_label,
            )
            continue
        if not isinstance(section_data, dict):
            _log.warning(
                "[%s] in %s is not a table; ignoring",
                section_name, source_label,
            )
            continue
        section_schema = _SCHEMA[section_name]
        for key, value in section_data.items():
            if key not in section_schema:
                _log.warning(
                    "unknown key '%s' in [%s] of %s; ignoring",
                    key, section_name, source_label,
                )
                continue
            accepted = section_schema[key]
            if not _check_type(value, accepted):
                _log.warning(
                    "[%s].%s=%r in %s has wrong type (%s); falling back to default",
                    section_name, key, value, source_label, type(value).__name__,
                )
                continue
            _set_field(config, section_name, key, value, source_label)


def _apply_env(config: Config, env: Mapping[str, str]) -> None:
    for env_var, section, field_name, parser in _ENV_MAPPINGS:
        if env_var not in env:
            continue
        raw = env[env_var]
        try:
            value = parser(raw)
        except (TypeError, ValueError):
            _log.warning(
                "env %s=%r is not a valid value; falling back to prior layer",
                env_var, raw,
            )
            continue
        _set_field(config, section, field_name, value, f"env {env_var}")


def _apply_cli(config: Config, args: argparse.Namespace) -> None:
    for attr, section, field_name, flag in _CLI_MAPPINGS:
        value = getattr(args, attr, None)
        if value is None:
            # All CLI flags MUST default to None so the loader can tell
            # "set" from "default". store_true with default=None gives that.
            continue
        _set_field(config, section, field_name, value, f"CLI {flag}")


def load_config(
    toml_path: Optional[str] = None,
    env: Optional[Mapping[str, str]] = None,
    cli_args: Optional[argparse.Namespace] = None,
) -> Config:
    """Build a Config by layering: defaults -> TOML -> env -> CLI -> validation."""
    if env is None:
        env = os.environ

    config = Config()
    for section_name, fields in _SCHEMA.items():
        for field_name in fields:
            config.sources[f"{section_name}.{field_name}"] = "defaults"

    if toml_path:
        toml_p = pathlib.Path(toml_path)
        if toml_p.exists():
            try:
                with open(toml_p, "rb") as f:
                    parsed = tomllib.load(f)
            except (OSError, tomllib.TOMLDecodeError) as e:
                _log.warning(
                    "could not load config TOML at %s: %s; ignoring",
                    toml_path, e,
                )
            else:
                _apply_toml(config, parsed, source_label=toml_path)
                config.toml_path = toml_path
        else:
            _log.warning(
                "config TOML path %s does not exist; ignoring", toml_path
            )

    _apply_env(config, env)

    if cli_args is not None:
        _apply_cli(config, cli_args)

    config.security.replay_window_s = _validate_replay_window(
        config.security.replay_window_s,
        source=config.sources.get("security.replay_window_s", "defaults"),
    )

    return config


def _format_toml_value(value: Any) -> str:
    if value is None:
        return '""'
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return repr(value)


def dump_config_toml(config: Config) -> str:
    """Emit the resolved Config as TOML with per-line ``# from <source>`` comments."""
    lines: list[str] = []
    if config.toml_path:
        lines.append(f"# Resolved config (TOML loaded from {config.toml_path})")
    else:
        lines.append("# Resolved config (no TOML loaded)")
    lines.append("")
    for section_name, fields in _SCHEMA.items():
        lines.append(f"[{section_name}]")
        section_obj = getattr(config, section_name)
        for field_name in fields:
            value = getattr(section_obj, field_name)
            source = config.sources.get(
                f"{section_name}.{field_name}", "defaults"
            )
            lines.append(
                f"{field_name} = {_format_toml_value(value)}  # from {source}"
            )
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"

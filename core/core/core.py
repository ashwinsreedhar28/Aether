"""RAVEN Mesh — single-process Python Core.

Implements the v0 wire protocol (`docs/SPEC.md`). Loads a manifest, listens
on HTTP, verifies HMAC signatures, validates payloads against per-surface
JSON Schemas, and routes messages between connected nodes via SSE delivery
+ POST responses. Audit log is JSON-per-line.

Control surfaces are exposed as the reserved built-in `core` node (SPEC §5).
Envelopes addressed to `core.<surface>` are dispatched in-process instead of
pushed to an SSE stream, but otherwise traverse the normal /v0/invoke path:
HMAC, replay window, allow-edge, schema validation, and audit all apply.

Out-of-band operator endpoints (SPEC §4.5):
    GET /v0/admin/stream     — raw SSE tap of every routed envelope
    GET /v0/admin/metrics    — Prometheus exposition of Core counters
Both are bearer-token gated by `ADMIN_TOKEN` and are NOT part of mesh
traffic. No other /v0/admin/* endpoints exist.
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import datetime as _dt
import hashlib
import hmac
import json
import logging
import os
import pathlib
import signal
import sys
import time
import uuid
from typing import Any

import yaml
from aiohttp import web
from jsonschema import ValidationError, validate as jsonschema_validate

from core.config import (
    Config,
    REPLAY_WINDOW_DEFAULT_S,
    REPLAY_WINDOW_MAX_S,
    REPLAY_WINDOW_MIN_S,
    dump_config_toml,
    load_config,
)
from core.manifest_validator import validate_manifest
from core.supervisor import Supervisor, make_script_resolver


ENVELOPE_TAIL_MAX = 200
NODE_QUEUE_MAX = 1024
LEGACY_ADMIN_TOKEN = "admin-dev-token"
ADMIN_RATE_BUCKET_MAX = 4096
# Bound the nonce LRU. One entry ≈ a uuid4 string; 16k bounds memory at a few
# hundred KB while comfortably exceeding any realistic message rate over a
# 300s window.
REPLAY_NONCE_LRU_MAX = 16384

# SPEC §5: the reserved built-in node.
CORE_NODE_ID = "core"
CORE_SURFACE_NAMES: tuple[str, ...] = (
    "state", "processes", "metrics", "audit_query",
    "set_manifest", "reload_manifest",
    "spawn", "stop", "restart", "reconcile", "drain",
)
_CORE_SCHEMAS_DIR = pathlib.Path(__file__).resolve().parent.parent / "schemas" / "core"
# Cap on lines read from audit.log per core.audit_query call. Keeps the
# tail-and-filter scan bounded; see notes/2026-05-10_spec_questions.md §4.
AUDIT_QUERY_SCAN_LIMIT = 100_000
AUDIT_QUERY_DEFAULT_LAST_N = 100
AUDIT_QUERY_MAX_LAST_N = 1000

_log = logging.getLogger("mesh.core")


class _PendingCancelled(Exception):
    """Pending invocation cancelled (e.g. by manifest reload). Carries the
    HTTP status + body that ``_route_invocation`` should return to the caller.
    """

    def __init__(self, status: int, body: dict):
        self.status = status
        self.body = body
        super().__init__(body.get("error", "pending_cancelled"))


class _CoreSurfaceError(Exception):
    """Raised by a core.* handler to surface as an ``error`` envelope."""

    def __init__(self, reason: str, **details: Any):
        self.reason = reason
        self.details = details
        super().__init__(reason)


def _load_replay_window_s() -> int:
    # Replay window (seconds). Bounded [5, 300] in code. Default 60.
    raw = os.environ.get("MESH_REPLAY_WINDOW_S")
    if raw is None:
        return REPLAY_WINDOW_DEFAULT_S
    try:
        val = int(raw)
    except (TypeError, ValueError):
        _log.warning(
            "MESH_REPLAY_WINDOW_S=%r is not a valid int; falling back to default %ds",
            raw, REPLAY_WINDOW_DEFAULT_S,
        )
        return REPLAY_WINDOW_DEFAULT_S
    if val < REPLAY_WINDOW_MIN_S:
        _log.warning(
            "MESH_REPLAY_WINDOW_S=%d below floor; clamped to %ds",
            val, REPLAY_WINDOW_MIN_S,
        )
        return REPLAY_WINDOW_MIN_S
    if val > REPLAY_WINDOW_MAX_S:
        _log.warning(
            "MESH_REPLAY_WINDOW_S=%d above ceiling; clamped to %ds",
            val, REPLAY_WINDOW_MAX_S,
        )
        return REPLAY_WINDOW_MAX_S
    return val


# ---------- helpers ----------

def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def _run_manifest_validator(
    parsed: Any, manifest_dir: pathlib.Path | str, *, source: str
) -> None:
    """Run the manifest validator and print findings to stdout.

    Warnings-mode: prints, never blocks. Summary line is always emitted so
    operators can see total counts at a glance. Format is `greppable`:
    ``[manifest_validator] LEVEL: <message> (source=<site>)``.
    """
    try:
        errors, warnings = validate_manifest(parsed, manifest_dir)
    except Exception as e:  # validator promises not to raise; defensive belt
        print(
            f"[manifest_validator] ERROR: validator crashed: {e!r} "
            f"(source={source})",
            flush=True,
        )
        return
    for w in warnings:
        print(
            f"[manifest_validator] WARNING: {w} (source={source})",
            flush=True,
        )
    for e in errors:
        print(
            f"[manifest_validator] ERROR: {e} (source={source})",
            flush=True,
        )
    print(
        f"[manifest_validator] {len(warnings)} warnings, {len(errors)} errors "
        f"(warnings-mode: not blocking) (source={source})",
        flush=True,
    )


def canonical(obj: dict) -> str:
    body = {k: v for k, v in obj.items() if k != "signature"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)


def sign(obj: dict, secret: str) -> str:
    return hmac.new(secret.encode(), canonical(obj).encode(), hashlib.sha256).hexdigest()


def verify(obj: dict, secret: str) -> bool:
    sig = obj.get("signature")
    if not isinstance(sig, str):
        return False
    return hmac.compare_digest(sig, sign(obj, secret))


def _parse_iso_ts(ts: Any) -> _dt.datetime | None:
    if not isinstance(ts, str):
        return None
    try:
        parsed = _dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_dt.timezone.utc)
    return parsed


def _ts_within_window(env_ts: Any, window_s: int) -> bool:
    parsed = _parse_iso_ts(env_ts)
    if parsed is None:
        return False
    now = _dt.datetime.now(_dt.timezone.utc)
    return abs((now - parsed).total_seconds()) <= window_s


def admin_token() -> str:
    """Return the configured admin token, refusing unset/legacy defaults.

    Raises ``RuntimeError`` if ``ADMIN_TOKEN`` is missing or equals the
    historical ``"admin-dev-token"`` placeholder. Failing loud at boot beats
    silently shipping a guessable fallback.
    """
    tok = os.environ.get("ADMIN_TOKEN")
    if not tok:
        raise RuntimeError(
            "ADMIN_TOKEN must be set in the environment before Core starts; "
            "there is no built-in default."
        )
    if tok == LEGACY_ADMIN_TOKEN:
        raise RuntimeError(
            "ADMIN_TOKEN is set to the legacy placeholder 'admin-dev-token'; "
            "rotate to a non-default value before starting Core."
        )
    return tok


def _admin_authed(request: web.Request) -> bool:
    # Header-only. Query-string secrets land in shell history, browser
    # history, server logs and Referer headers — refuse them outright.
    token = request.headers.get("X-Admin-Token")
    if not token:
        return False
    try:
        expected = admin_token()
    except RuntimeError:
        return False
    return hmac.compare_digest(token, expected)


# ---------- state ----------

class CoreState:
    def __init__(self, manifest_path: str, audit_path: str,
                 *, config: Config | None = None):
        self.manifest_path = pathlib.Path(manifest_path).resolve()
        self.audit_path = pathlib.Path(audit_path).resolve()
        self.config: Config = config if config is not None else load_config(toml_path=None)
        self.nodes_decl: dict[str, dict] = {}
        self.connections: dict[str, dict] = {}
        self.sessions: dict[str, str] = {}
        self.edges: set[tuple[str, str]] = set()
        self.pending: dict[str, dict] = {}
        self.audit_lock = asyncio.Lock()
        self._streams: set[asyncio.Queue] = set()
        # Admin tap.
        self._admin_streams: set[asyncio.Queue] = set()
        self.envelope_tail: collections.deque = collections.deque(maxlen=ENVELOPE_TAIL_MAX)
        # Single LRU of envelope ids that have already been routed. Shared
        # across every replay-gated endpoint so the uniqueness invariant is
        # protocol-wide, not per-route.
        self._replay_nonces: collections.OrderedDict[str, None] = collections.OrderedDict()
        self.replay_window_s: int = self.config.security.replay_window_s
        # Process supervisor (set by make_app after manifest loads).
        # Optional — Core works fine without it; falls back to scripts/run_mesh.sh
        # owning processes. When attached, core.{spawn,stop,restart,reconcile,drain}
        # become functional surfaces.
        self.supervisor: Supervisor | None = None
        # Raw manifest nodes keyed by id (for supervisor reconcile + spawn args).
        self.manifest_nodes_raw: dict[str, dict] = {}
        # SPEC §5.1: 'core' is always present, with secret from MESH_CORE_SECRET.
        self._core_secret: str = self._load_core_secret()
        self._install_core_node()

    # manifest -----------------------------------------------------------

    def load_manifest(self, *, source: str = "startup", validate: bool = True) -> None:
        self._reset_manifest_state()
        text = self.manifest_path.read_text()
        m = yaml.safe_load(text)
        manifest_dir = self.manifest_path.parent
        if validate:
            _run_manifest_validator(m, manifest_dir, source=source)
        for node in m.get("nodes", []):
            secret = self._resolve_secret(node["id"], node.get("identity_secret", ""))
            surfaces: dict[str, dict] = {}
            for s in node.get("surfaces", []):
                schema_path = (manifest_dir / s["schema"]).resolve()
                schema = json.loads(schema_path.read_text())
                surfaces[s["name"]] = {
                    "type": s["type"],
                    "schema": schema,
                    "invocation_mode": s.get("invocation_mode", "request_response"),
                }
            self.nodes_decl[node["id"]] = {
                "kind": node.get("kind"),
                "runtime": node.get("runtime", "local-process"),
                "metadata": node.get("metadata", {}),
                "secret": secret,
                "surfaces": surfaces,
            }
            # Keep the raw node dict for supervisor consumption.
            self.manifest_nodes_raw[node["id"]] = node
        for rel in m.get("relationships", []):
            self.edges.add((rel["from"], rel["to"]))
        # Re-install the built-in 'core' node — it survives every manifest reload
        # whether or not the YAML names it. SPEC §5.1.
        self._install_core_node()

    async def reload_manifest_runtime(self, *, source: str,
                                      validate: bool = True) -> dict:
        """Reload the manifest and apply SPEC §5.4 session semantics.

        - Sessions for nodes still present in the new manifest stay open.
        - Sessions for nodes that have disappeared are closed.
        - Pending invocations whose ``(from, to)`` edge no longer exists are
          failed with ``denied_no_relationship`` (audited).
        - Every still-connected node gets a ``manifest_reloaded`` SSE event.
        """
        pre_node_ids = set(self.nodes_decl.keys())
        pre_edges = set(self.edges)
        self.load_manifest(source=source, validate=validate)
        post_node_ids = set(self.nodes_decl.keys())
        post_edges = self.edges

        closed_sessions: list[str] = []
        for nid in pre_node_ids - post_node_ids:
            conn = self.connections.pop(nid, None)
            if conn is None:
                continue
            self.sessions.pop(conn["session_id"], None)
            try:
                conn["queue"].put_nowait({"type": "_close", "data": {}})
            except asyncio.QueueFull:
                pass
            closed_sessions.append(nid)

        failed_inflight: list[str] = []
        for msg_id, entry in list(self.pending.items()):
            from_node = entry.get("from_node")
            to_surface = entry.get("to_surface")
            if (from_node, to_surface) in post_edges:
                continue
            fut: asyncio.Future = entry["future"]
            if not fut.done():
                fut.set_exception(_PendingCancelled(403, {
                    "error": "denied_no_relationship",
                    "from": from_node,
                    "to": to_surface,
                    "reason": "manifest_reloaded",
                }))
            self.pending.pop(msg_id, None)
            failed_inflight.append(msg_id)
            await self.audit(
                type="invocation", from_node=from_node, to_surface=to_surface,
                decision="denied_no_relationship", correlation_id=msg_id,
                details={"reason": "manifest_reloaded"},
            )

        edges_changed = pre_edges != post_edges
        payload = {"timestamp": now_iso(), "edges_changed": edges_changed}
        for conn in self.connections.values():
            try:
                conn["queue"].put_nowait({"type": "manifest_reloaded", "data": payload})
            except asyncio.QueueFull:
                pass
        return {
            "closed_sessions": closed_sessions,
            "failed_inflight": failed_inflight,
            "edges_changed": edges_changed,
        }

    def _reset_manifest_state(self) -> None:
        # Connections, sessions, pending, tail, streams stay live across reload.
        self.nodes_decl = {}
        self.edges = set()
        self.manifest_nodes_raw = {}

    def _load_core_secret(self) -> str:
        """Read MESH_CORE_SECRET (SPEC §5.1). Autogenerate if unset, for dev/tests."""
        val = os.environ.get("MESH_CORE_SECRET")
        if val:
            return val
        val = hashlib.sha256(b"mesh:core:autogen").hexdigest()
        os.environ["MESH_CORE_SECRET"] = val
        return val

    def _install_core_node(self) -> None:
        """Add the reserved 'core' node and its 11 surfaces to ``nodes_decl``.

        Idempotent — safe to call after every manifest reload. SPEC §5.1
        requires `core` to be listed in /v0/introspect snapshots whether or
        not the manifest YAML names it.
        """
        surfaces: dict[str, dict] = {}
        for surface_name in CORE_SURFACE_NAMES:
            schema_path = _CORE_SCHEMAS_DIR / f"{surface_name}.json"
            schema = json.loads(schema_path.read_text())
            surfaces[surface_name] = {
                "type": "tool",
                "schema": schema,
                "invocation_mode": "request_response",
            }
        self.nodes_decl[CORE_NODE_ID] = {
            "kind": "capability",
            "runtime": "in-process",
            "metadata": {"builtin": True},
            "secret": self._core_secret,
            "surfaces": surfaces,
        }

    def _resolve_secret(self, node_id: str, spec: str) -> str:
        if spec.startswith("env:"):
            var = spec[4:]
            val = os.environ.get(var)
            if val:
                return val
            val = hashlib.sha256(f"mesh:{node_id}:autogen".encode()).hexdigest()
            os.environ[var] = val
            return val
        return spec or hashlib.sha256(f"mesh:{node_id}:autogen".encode()).hexdigest()

    def relationships_for(self, node_id: str) -> list[dict]:
        out = []
        for f, t in sorted(self.edges):
            if f == node_id or t.split(".", 1)[0] == node_id:
                out.append({"from": f, "to": t})
        return out

    # replay protection --------------------------------------------------

    def check_replay(self, env: dict) -> tuple[bool, str | None]:
        """Validate envelope freshness + nonce uniqueness.

        Returns ``(ok, error_code)``. On the happy path the envelope's id is
        recorded in the protocol-wide LRU so a second presentation is rejected.
        """
        if not _ts_within_window(env.get("timestamp"), self.replay_window_s):
            return False, "stale_or_missing_timestamp"
        msg_id = env.get("id")
        if not isinstance(msg_id, str) or not msg_id:
            return False, "missing_id"
        if msg_id in self._replay_nonces:
            return False, "replay_detected"
        self._replay_nonces[msg_id] = None
        while len(self._replay_nonces) > REPLAY_NONCE_LRU_MAX:
            self._replay_nonces.popitem(last=False)
        return True, None

    def check_timestamp_only(self, env: dict) -> tuple[bool, float | None]:
        """Validate envelope freshness without touching the nonce LRU.

        Returns ``(ok, drift_s)``. ``drift_s`` is the absolute drift in
        seconds when the timestamp parses, or ``None`` when missing/malformed.
        Use this on endpoints whose envelope schema lacks a unique id field;
        full coverage requires the SDK to add an id and switch to
        ``check_replay``.
        """
        ts = env.get("timestamp")
        parsed = _parse_iso_ts(ts)
        if parsed is None:
            return False, None
        drift = abs(
            (_dt.datetime.now(_dt.timezone.utc) - parsed).total_seconds()
        )
        if drift > self.replay_window_s:
            return False, drift
        return True, drift

    # audit + tap --------------------------------------------------------

    async def audit(self, **fields: Any) -> None:
        evt = {"id": str(uuid.uuid4()), "timestamp": now_iso(), **fields}
        line = json.dumps(evt) + "\n"
        async with self.audit_lock:
            self.audit_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.audit_path, "a") as f:
                f.write(line)

    def emit_envelope(self, *, env: dict, direction: str,
                      signature_valid: bool, route_status: str) -> None:
        evt = {
            "ts": now_iso(),
            "direction": direction,
            "from_node": env.get("from"),
            "to_surface": env.get("to"),
            "msg_id": env.get("id"),
            "correlation_id": env.get("correlation_id"),
            "kind": env.get("kind"),
            "payload": env.get("payload", {}),
            "wrapped": env.get("wrapped"),
            "signature_valid": signature_valid,
            "route_status": route_status,
        }
        self.envelope_tail.append(evt)
        if not self._admin_streams:
            return
        for q in list(self._admin_streams):
            try:
                q.put_nowait(evt)
            except asyncio.QueueFull:
                pass


# ---------- core.* in-process handlers ----------
#
# Dispatched by ``_route_invocation`` whenever ``to`` resolves to the reserved
# ``core`` node. Handlers receive ``(state, env, payload)`` and return a JSON-
# serialisable dict; raising ``_CoreSurfaceError`` produces an ``error``
# envelope. ``_dispatch_core_surface`` wraps the result in a signed envelope.

def _need_supervisor(state: "CoreState") -> None:
    if state.supervisor is None:
        raise _CoreSurfaceError(
            "supervisor_disabled",
            details=("Core started without --supervisor; "
                     "scripts/run_mesh.sh owns processes"),
        )


def _nodes_state_view(state: "CoreState") -> list[dict]:
    out = []
    for nid, decl in state.nodes_decl.items():
        out.append({
            "id": nid,
            "kind": decl["kind"],
            "runtime": decl["runtime"],
            "metadata": decl["metadata"],
            "connected": nid in state.connections,
            "surfaces": [
                {
                    "name": n,
                    "type": s["type"],
                    "invocation_mode": s["invocation_mode"],
                    "schema": s["schema"],
                }
                for n, s in decl["surfaces"].items()
            ],
        })
    return out


async def _core_state(state: "CoreState", env: dict, payload: dict) -> dict:
    return {
        "manifest_path": str(state.manifest_path),
        "audit_path": str(state.audit_path),
        "nodes": _nodes_state_view(state),
        "relationships": [{"from": f, "to": t} for f, t in sorted(state.edges)],
        "envelope_tail": list(state.envelope_tail),
    }


async def _core_processes(state: "CoreState", env: dict, payload: dict) -> dict:
    if state.supervisor is None:
        return {"supervisor_enabled": False, "processes": []}
    return {
        "supervisor_enabled": True,
        "processes": state.supervisor.list_processes(),
    }


async def _core_metrics(state: "CoreState", env: dict, payload: dict) -> dict:
    metrics = {
        "nodes_declared": len(state.nodes_decl),
        "nodes_connected": len(state.connections),
        "edges": len(state.edges),
        "pending": len(state.pending),
        "replay_nonce_lru": len(state._replay_nonces),
        "envelope_tail": len(state.envelope_tail),
        "admin_streams": len(state._admin_streams),
        "node_streams": len(state._streams),
        "supervisor": state.supervisor.metrics() if state.supervisor else None,
    }
    return metrics


async def _core_spawn(state: "CoreState", env: dict, payload: dict) -> dict:
    _need_supervisor(state)
    nid = payload["node_id"]
    manifest_node = state.manifest_nodes_raw.get(nid)
    if manifest_node is None:
        raise _CoreSurfaceError("unknown_node", node_id=nid)
    return await state.supervisor.spawn(nid, manifest_node)


async def _core_stop(state: "CoreState", env: dict, payload: dict) -> dict:
    _need_supervisor(state)
    nid = payload["node_id"]
    graceful = bool(payload.get("graceful", True))
    return await state.supervisor.stop(nid, graceful=graceful)


async def _core_restart(state: "CoreState", env: dict, payload: dict) -> dict:
    _need_supervisor(state)
    nid = payload["node_id"]
    manifest_node = state.manifest_nodes_raw.get(nid)
    if manifest_node is None:
        raise _CoreSurfaceError("unknown_node", node_id=nid)
    return await state.supervisor.restart(nid, manifest_node)


async def _core_reconcile(state: "CoreState", env: dict, payload: dict) -> dict:
    _need_supervisor(state)
    return await state.supervisor.reconcile(state.manifest_nodes_raw)


async def _core_drain(state: "CoreState", env: dict, payload: dict) -> dict:
    _need_supervisor(state)
    nid = payload["node_id"]
    timeout = float(payload.get("timeout", 30.0))
    return await state.supervisor.drain(nid, timeout=timeout)


async def _core_set_manifest(state: "CoreState", env: dict, payload: dict) -> dict:
    raw = payload["yaml"]
    try:
        parsed = yaml.safe_load(raw)
    except yaml.YAMLError as e:
        raise _CoreSurfaceError("bad_yaml", details=str(e))
    if not isinstance(parsed, dict) or "nodes" not in parsed:
        raise _CoreSurfaceError("manifest_missing_nodes")
    _run_manifest_validator(
        parsed, state.manifest_path.parent, source="core.set_manifest",
    )
    backup = state.manifest_path.with_suffix(state.manifest_path.suffix + ".bak")
    if state.manifest_path.exists():
        backup.write_text(state.manifest_path.read_text())
    state.manifest_path.write_text(raw)
    try:
        result = await state.reload_manifest_runtime(
            source="core.set_manifest", validate=False,
        )
    except Exception as e:
        if backup.exists():
            state.manifest_path.write_text(backup.read_text())
            await state.reload_manifest_runtime(
                source="core.set_manifest:rollback", validate=False,
            )
        raise _CoreSurfaceError("load_failed", details=str(e))
    return {
        "ok": True,
        "manifest_path": str(state.manifest_path),
        "nodes_declared": len(state.nodes_decl),
        "edges": len(state.edges),
        **result,
    }


async def _core_reload_manifest(state: "CoreState", env: dict, payload: dict) -> dict:
    try:
        result = await state.reload_manifest_runtime(source="core.reload_manifest")
    except Exception as e:
        raise _CoreSurfaceError("load_failed", details=str(e))
    return {
        "ok": True,
        "nodes_declared": len(state.nodes_decl),
        "edges": len(state.edges),
        **result,
    }


def _read_audit_tail_lines(path: pathlib.Path, limit: int) -> list[bytes]:
    """Read up to ``limit`` lines from the end of ``path`` without slurping
    the whole file. Reads in 64 KiB blocks from the tail until the requested
    line count is reached or the file is exhausted.
    """
    if not path.exists():
        return []
    block = 64 * 1024
    data = b""
    with open(path, "rb") as f:
        f.seek(0, 2)
        pos = f.tell()
        while pos > 0:
            read = min(block, pos)
            pos -= read
            f.seek(pos)
            data = f.read(read) + data
            if data.count(b"\n") > limit:
                break
    lines = data.splitlines()
    return lines[-limit:] if len(lines) > limit else lines


async def _core_audit_query(state: "CoreState", env: dict, payload: dict) -> dict:
    """Tail-and-filter on audit.log per SPEC §5.3.

    Filter fields are conjunctive AND. Returns up to ``last_n`` matches in
    most-recent-first order. Bounded by ``AUDIT_QUERY_SCAN_LIMIT`` so a
    single call cannot read an unbounded number of lines.
    """
    since = payload.get("since")
    until = payload.get("until")
    from_node = payload.get("from_node")
    to_surface = payload.get("to_surface")
    decision = payload.get("decision")
    correlation_id = payload.get("correlation_id")
    last_n = int(payload.get("last_n", AUDIT_QUERY_DEFAULT_LAST_N))
    last_n = max(1, min(AUDIT_QUERY_MAX_LAST_N, last_n))

    since_dt = _parse_iso_ts(since) if since else None
    until_dt = _parse_iso_ts(until) if until else None
    if since and since_dt is None:
        raise _CoreSurfaceError("bad_since", value=since)
    if until and until_dt is None:
        raise _CoreSurfaceError("bad_until", value=until)

    raw_lines = _read_audit_tail_lines(state.audit_path, AUDIT_QUERY_SCAN_LIMIT)
    truncated = len(raw_lines) >= AUDIT_QUERY_SCAN_LIMIT
    matches: list[dict] = []
    scanned = 0
    for raw in reversed(raw_lines):
        scanned += 1
        try:
            evt = json.loads(raw)
        except (ValueError, json.JSONDecodeError):
            continue
        if from_node and evt.get("from_node") != from_node:
            continue
        if to_surface and evt.get("to_surface") != to_surface:
            continue
        if decision and evt.get("decision") != decision:
            continue
        if correlation_id and evt.get("correlation_id") != correlation_id:
            continue
        ts = _parse_iso_ts(evt.get("timestamp"))
        if since_dt and (ts is None or ts < since_dt):
            continue
        if until_dt and (ts is None or ts > until_dt):
            continue
        matches.append(evt)
        if len(matches) >= last_n:
            break
    return {"results": matches, "scanned": scanned, "truncated": truncated}


_CORE_HANDLERS: dict[str, Any] = {
    "state": _core_state,
    "processes": _core_processes,
    "metrics": _core_metrics,
    "audit_query": _core_audit_query,
    "set_manifest": _core_set_manifest,
    "reload_manifest": _core_reload_manifest,
    "spawn": _core_spawn,
    "stop": _core_stop,
    "restart": _core_restart,
    "reconcile": _core_reconcile,
    "drain": _core_drain,
}


async def _dispatch_core_surface(state: "CoreState", surface_name: str,
                                  env: dict) -> dict:
    """Run the named core handler and wrap its result in a signed envelope."""
    handler = _CORE_HANDLERS.get(surface_name)
    response: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "correlation_id": env.get("correlation_id") or env.get("id"),
        "from": CORE_NODE_ID,
        "to": env.get("from"),
        "timestamp": now_iso(),
    }
    try:
        if handler is None:
            raise _CoreSurfaceError("unknown_surface", surface=surface_name)
        result = await handler(state, env, env.get("payload") or {})
        response["kind"] = "response"
        response["payload"] = result
    except _CoreSurfaceError as e:
        response["kind"] = "error"
        response["payload"] = {"error": e.reason, **e.details}
    except Exception as e:
        _log.exception("core surface %s raised", surface_name)
        response["kind"] = "error"
        response["payload"] = {
            "error": "core_handler_exception",
            "details": str(e)[:500],
        }
    response["signature"] = sign(response, state._core_secret)
    return response


# ---------- handlers ----------

async def handle_register(request: web.Request) -> web.Response:
    state: CoreState = request.app["state"]
    body = await request.json()
    node_id = body.get("node_id")
    decl = state.nodes_decl.get(node_id) if node_id else None
    if not decl:
        return web.json_response({"error": "unknown_node", "node_id": node_id}, status=404)
    if not verify(body, decl["secret"]):
        return web.json_response({"error": "bad_signature"}, status=401)
    # register envelopes lack a unique id; nonce LRU would require an SDK change.
    # Timestamp-only narrows the replay window to MESH_REPLAY_WINDOW_S; full
    # coverage requires SDK envelope-id field (deferred to next SDK bump).
    ok, drift = state.check_timestamp_only(body)
    if not ok:
        _log.info(
            "[replay] register rejected: timestamp drift %ss exceeds window %ss for node_id=%s",
            f"{drift:.3f}" if drift is not None else "missing",
            state.replay_window_s,
            node_id,
        )
        return web.json_response(
            {"error": "stale_register", "reason": "timestamp outside replay window"},
            status=401,
        )
    old = state.connections.get(node_id)
    if old:
        state.sessions.pop(old["session_id"], None)
        try:
            old["queue"].put_nowait({"type": "_close", "data": {}})
        except asyncio.QueueFull:
            pass
    session_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue(maxsize=NODE_QUEUE_MAX)
    state.connections[node_id] = {
        "session_id": session_id,
        "queue": queue,
        "connected_at": now_iso(),
    }
    state.sessions[session_id] = node_id
    surfaces_view = []
    for name, s in decl["surfaces"].items():
        surfaces_view.append({
            "name": name,
            "type": s["type"],
            "invocation_mode": s["invocation_mode"],
        })
    return web.json_response({
        "session_id": session_id,
        "node_id": node_id,
        "kind": decl["kind"],
        "surfaces": surfaces_view,
        "relationships": state.relationships_for(node_id),
    })


async def _route_invocation(state: CoreState, env: dict,
                             *, signature_pre_verified: bool = False) -> tuple[int, dict]:
    """Core invocation routing. Returns ``(http_status, response_dict)``.

    Called by /v0/invoke after JSON parse. The ``signature_pre_verified``
    knob is reserved for in-process callers that have already authenticated
    the envelope (no current users — kept so future trusted shims don't
    have to re-derive HMACs).
    """
    msg_id = env.get("id") or str(uuid.uuid4())
    env.setdefault("id", msg_id)
    correlation_id = env.get("correlation_id") or msg_id
    env.setdefault("correlation_id", correlation_id)
    from_node = env.get("from")
    to = env.get("to")
    if env.get("kind") not in (None, "invocation"):
        state.emit_envelope(env=env, direction="in", signature_valid=signature_pre_verified,
                            route_status="bad_kind")
        return 400, {"error": "bad_kind", "expected": "invocation"}
    decl = state.nodes_decl.get(from_node) if from_node else None
    if not decl:
        await state.audit(type="invocation", from_node=from_node, to_surface=to,
                          decision="denied_unknown_node", correlation_id=correlation_id, details={})
        state.emit_envelope(env=env, direction="in", signature_valid=False,
                            route_status="denied_unknown_node")
        return 404, {"error": "unknown_node"}
    sig_valid = signature_pre_verified or verify(env, decl["secret"])
    if not sig_valid:
        await state.audit(type="invocation", from_node=from_node, to_surface=to,
                          decision="denied_signature_invalid", correlation_id=correlation_id, details={})
        state.emit_envelope(env=env, direction="in", signature_valid=False,
                            route_status="denied_signature_invalid")
        return 401, {"error": "bad_signature"}
    if not signature_pre_verified:
        ok, err = state.check_replay(env)
        if not ok:
            # SPEC §7: any replay-window or nonce rejection is a `denied_replay`.
            await state.audit(type="invocation", from_node=from_node, to_surface=to,
                              decision="denied_replay", correlation_id=correlation_id,
                              details={"reason": err})
            state.emit_envelope(env=env, direction="in", signature_valid=True,
                                route_status="denied_replay")
            status = 409 if err == "replay_detected" else 401
            return status, {"error": err}
    if not isinstance(to, str) or "." not in to:
        state.emit_envelope(env=env, direction="in", signature_valid=True,
                            route_status="bad_surface_id")
        return 400, {"error": "bad_surface_id"}
    if (from_node, to) not in state.edges:
        await state.audit(type="invocation", from_node=from_node, to_surface=to,
                          decision="denied_no_relationship", correlation_id=correlation_id, details={})
        state.emit_envelope(env=env, direction="in", signature_valid=True,
                            route_status="denied_no_relationship")
        return 403, {"error": "denied_no_relationship", "from": from_node, "to": to}
    target_node, surface_name = to.split(".", 1)
    target_decl = state.nodes_decl.get(target_node)
    if not target_decl or surface_name not in target_decl["surfaces"]:
        await state.audit(type="invocation", from_node=from_node, to_surface=to,
                          decision="denied_unknown_surface", correlation_id=correlation_id, details={})
        state.emit_envelope(env=env, direction="in", signature_valid=True,
                            route_status="denied_unknown_surface")
        return 404, {"error": "unknown_surface"}
    surface = target_decl["surfaces"][surface_name]
    try:
        jsonschema_validate(env.get("payload", {}), surface["schema"])
    except ValidationError as e:
        await state.audit(type="invocation", from_node=from_node, to_surface=to,
                          decision="denied_schema_invalid", correlation_id=correlation_id,
                          details={"error": str(e)[:500]})
        state.emit_envelope(env=env, direction="in", signature_valid=True,
                            route_status="denied_schema_invalid")
        return 400, {"error": "denied_schema_invalid", "details": str(e)}
    # SPEC §5.1: envelopes to core.* dispatch in-process; no SSE delivery.
    if target_node == CORE_NODE_ID:
        await state.audit(type="invocation", from_node=from_node, to_surface=to,
                          decision="routed", correlation_id=correlation_id,
                          details={"msg_id": msg_id, "in_process": True})
        state.emit_envelope(env=env, direction="in", signature_valid=True,
                            route_status="routed")
        response_env = await _dispatch_core_surface(state, surface_name, env)
        await state.audit(type="response", from_node=CORE_NODE_ID, to_surface=from_node,
                          decision="routed", correlation_id=correlation_id,
                          details={"kind": response_env.get("kind")})
        state.emit_envelope(env=response_env, direction="out",
                            signature_valid=True, route_status="routed")
        return 200, response_env
    target_conn = state.connections.get(target_node)
    if not target_conn:
        await state.audit(type="invocation", from_node=from_node, to_surface=to,
                          decision="denied_node_unreachable", correlation_id=correlation_id, details={})
        state.emit_envelope(env=env, direction="in", signature_valid=True,
                            route_status="denied_node_unreachable")
        return 503, {"error": "denied_node_unreachable", "node": target_node}
    deliver_event = {"type": "deliver", "data": env}
    target_queue: asyncio.Queue = target_conn["queue"]
    if surface["invocation_mode"] == "fire_and_forget":
        try:
            target_queue.put_nowait(deliver_event)
        except asyncio.QueueFull:
            await state.audit(type="invocation", from_node=from_node, to_surface=to,
                              decision="denied_queue_full", correlation_id=correlation_id,
                              details={"target_node": target_node, "queue_max": NODE_QUEUE_MAX})
            state.emit_envelope(env=env, direction="in", signature_valid=True,
                                route_status="denied_queue_full")
            return 503, {"error": "denied_queue_full", "node": target_node}
        await state.audit(type="invocation", from_node=from_node, to_surface=to,
                          decision="routed", correlation_id=correlation_id, details={"msg_id": msg_id})
        state.emit_envelope(env=env, direction="in", signature_valid=True, route_status="routed")
        return 202, {"id": msg_id, "status": "accepted"}
    fut: asyncio.Future = asyncio.get_event_loop().create_future()
    state.pending[msg_id] = {
        "future": fut,
        "target_node": target_node,
        "from_node": from_node,
        "to_surface": to,
    }
    try:
        target_queue.put_nowait(deliver_event)
    except asyncio.QueueFull:
        state.pending.pop(msg_id, None)
        await state.audit(type="invocation", from_node=from_node, to_surface=to,
                          decision="denied_queue_full", correlation_id=correlation_id,
                          details={"target_node": target_node, "queue_max": NODE_QUEUE_MAX})
        state.emit_envelope(env=env, direction="in", signature_valid=True,
                            route_status="denied_queue_full")
        return 503, {"error": "denied_queue_full", "node": target_node}
    await state.audit(type="invocation", from_node=from_node, to_surface=to,
                      decision="routed", correlation_id=correlation_id, details={"msg_id": msg_id})
    state.emit_envelope(env=env, direction="in", signature_valid=True, route_status="routed")
    timeout = float(state.config.server.invoke_timeout_s)
    try:
        result = await asyncio.wait_for(fut, timeout=timeout)
    except asyncio.TimeoutError:
        state.pending.pop(msg_id, None)
        await state.audit(type="invocation", from_node=from_node, to_surface=to,
                          decision="timeout", correlation_id=correlation_id, details={})
        return 504, {"error": "timeout", "id": msg_id}
    except _PendingCancelled as cancelled:
        state.pending.pop(msg_id, None)
        return cancelled.status, cancelled.body
    finally:
        state.pending.pop(msg_id, None)
    return 200, result


async def handle_invoke(request: web.Request) -> web.Response:
    state: CoreState = request.app["state"]
    env = await request.json()
    status, body = await _route_invocation(state, env)
    return web.json_response(body, status=status)


async def handle_respond(request: web.Request) -> web.Response:
    state: CoreState = request.app["state"]
    env = await request.json()
    from_node = env.get("from")
    decl = state.nodes_decl.get(from_node) if from_node else None
    if not decl:
        return web.json_response({"error": "unknown_node"}, status=404)
    if not verify(env, decl["secret"]):
        return web.json_response({"error": "bad_signature"}, status=401)
    if env.get("kind") not in ("response", "error"):
        return web.json_response({"error": "bad_kind", "expected": "response|error"}, status=400)
    ok, err = state.check_replay(env)
    if not ok:
        # SPEC §7: replay-window or nonce rejections audit as `denied_replay`.
        await state.audit(type="response", from_node=from_node,
                          to_surface=env.get("to", ""), decision="denied_replay",
                          correlation_id=env.get("correlation_id"), details={"reason": err})
        return web.json_response({"error": err}, status=409 if err == "replay_detected" else 401)
    correlation_id = env.get("correlation_id")
    if not correlation_id:
        return web.json_response({"error": "missing_correlation_id"}, status=400)
    entry = state.pending.get(correlation_id)
    if not entry or entry["future"].done():
        return web.json_response({"error": "no_pending_request", "correlation_id": correlation_id}, status=404)
    if entry["target_node"] != from_node:
        return web.json_response({"error": "responder_not_target", "expected": entry["target_node"]}, status=403)
    await state.audit(type="response", from_node=from_node, to_surface=env.get("to", ""),
                      decision="routed", correlation_id=correlation_id,
                      details={"kind": env.get("kind")})
    state.emit_envelope(env=env, direction="out", signature_valid=True, route_status="routed")
    entry["future"].set_result(env)
    return web.json_response({"status": "accepted"}, status=200)


async def handle_stream(request: web.Request) -> web.StreamResponse:
    state: CoreState = request.app["state"]
    session = request.query.get("session")
    node_id = state.sessions.get(session) if session else None
    if not node_id:
        return web.json_response({"error": "unknown_session"}, status=401)
    conn = state.connections.get(node_id)
    if not conn or conn["session_id"] != session:
        return web.json_response({"error": "stale_session"}, status=401)
    response = web.StreamResponse(status=200, headers={
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })
    await response.prepare(request)
    queue: asyncio.Queue = conn["queue"]
    request.app["state"]._streams.add(queue)  # noqa: SLF001
    try:
        await response.write(
            f"event: hello\ndata: {json.dumps({'node_id': node_id, 'session_id': session})}\n\n".encode()
        )
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=2)
            except asyncio.TimeoutError:
                try:
                    await response.write(b": heartbeat\n\n")
                except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError):
                    break
                continue
            if event.get("type") == "_close":
                break
            line = f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
            try:
                await response.write(line.encode())
            except (ConnectionResetError, BrokenPipeError):
                await queue.put(event)
                break
    except (asyncio.CancelledError, ConnectionResetError, BrokenPipeError):
        pass
    finally:
        request.app["state"]._streams.discard(queue)  # noqa: SLF001
    return response


async def handle_health(request: web.Request) -> web.Response:
    state: CoreState = request.app["state"]
    return web.json_response({
        "ok": True,
        "nodes_declared": len(state.nodes_decl),
        "nodes_connected": len(state.connections),
        "edges": len(state.edges),
        "pending": len(state.pending),
    })


async def handle_introspect(request: web.Request) -> web.Response:
    state: CoreState = request.app["state"]
    nodes = []
    for nid, decl in state.nodes_decl.items():
        nodes.append({
            "id": nid,
            "kind": decl["kind"],
            "runtime": decl["runtime"],
            "metadata": decl["metadata"],
            "connected": nid in state.connections,
            "surfaces": [
                {"name": n, "type": s["type"], "invocation_mode": s["invocation_mode"]}
                for n, s in decl["surfaces"].items()
            ],
        })
    edges = [{"from": f, "to": t} for f, t in sorted(state.edges)]
    return web.json_response({"nodes": nodes, "relationships": edges})


# ---------- admin (operator-only, SPEC §4.5) ----------
#
# Only TWO admin endpoints exist per SPEC §4.5:
#   GET /v0/admin/stream   — raw SSE tap of every routed envelope
#   GET /v0/admin/metrics  — Prometheus exposition of Core counters
# Both are bearer-token gated. All previously-existing /v0/admin/{state,
# manifest, reload, invoke, processes, spawn, stop, restart, reconcile,
# drain} surfaces have moved to ``core.<name>`` and travel /v0/invoke.


async def handle_admin_stream(request: web.Request) -> web.StreamResponse:
    if not _admin_authed(request):
        return web.json_response({"error": "unauthorized"}, status=401)
    state: CoreState = request.app["state"]
    response = web.StreamResponse(status=200, headers={
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-Accel-Buffering": "no",
    })
    await response.prepare(request)
    queue: asyncio.Queue = asyncio.Queue(maxsize=1024)
    state._admin_streams.add(queue)  # noqa: SLF001
    try:
        await response.write(b"event: hello\ndata: {}\n\n")
        for evt in list(state.envelope_tail):
            await response.write(
                f"event: envelope\ndata: {json.dumps(evt)}\n\n".encode()
            )
        while True:
            try:
                evt = await asyncio.wait_for(queue.get(), timeout=10)
            except asyncio.TimeoutError:
                try:
                    await response.write(b": heartbeat\n\n")
                except (ConnectionResetError, BrokenPipeError):
                    break
                continue
            try:
                await response.write(
                    f"event: envelope\ndata: {json.dumps(evt)}\n\n".encode()
                )
            except (ConnectionResetError, BrokenPipeError):
                break
    except (asyncio.CancelledError, ConnectionResetError, BrokenPipeError):
        pass
    finally:
        state._admin_streams.discard(queue)  # noqa: SLF001
    return response


async def handle_admin_metrics(request: web.Request) -> web.Response:
    """Prometheus exposition of Core counters/gauges (SPEC §4.5).

    Plain-text ``text/plain; version=0.0.4`` body. Every metric is a gauge —
    Core does not track monotonic counters at this layer (those live in the
    audit log). Supervisor totals are surfaced when supervisor is attached.
    """
    if not _admin_authed(request):
        return web.json_response({"error": "unauthorized"}, status=401)
    state: CoreState = request.app["state"]
    lines: list[str] = []

    def gauge(name: str, value: float, help_text: str,
              labels: dict[str, str] | None = None) -> None:
        if not lines or not lines[-1].startswith(f"# TYPE {name} "):
            lines.append(f"# HELP {name} {help_text}")
            lines.append(f"# TYPE {name} gauge")
        if labels:
            label_str = ",".join(
                f'{k}="{_prom_escape(v)}"' for k, v in sorted(labels.items())
            )
            lines.append(f"{name}{{{label_str}}} {value}")
        else:
            lines.append(f"{name} {value}")

    gauge("mesh_nodes_declared", len(state.nodes_decl),
          "Number of nodes declared in the manifest (includes the built-in core node).")
    gauge("mesh_nodes_connected", len(state.connections),
          "Number of nodes with a live SSE session.")
    gauge("mesh_edges", len(state.edges),
          "Number of allow-edges declared in the manifest.")
    gauge("mesh_pending_invocations", len(state.pending),
          "Invocations awaiting a response.")
    gauge("mesh_replay_nonce_lru", len(state._replay_nonces),  # noqa: SLF001
          "Current size of the replay-protection nonce LRU.")
    gauge("mesh_envelope_tail_size", len(state.envelope_tail),
          "Current depth of the in-memory routed-envelope ring buffer.")
    gauge("mesh_admin_streams", len(state._admin_streams),  # noqa: SLF001
          "Number of /v0/admin/stream consumers attached.")
    gauge("mesh_node_streams", len(state._streams),  # noqa: SLF001
          "Number of /v0/stream node consumers attached.")
    gauge("mesh_replay_window_seconds", state.replay_window_s,
          "Configured replay-window width in seconds.")

    if state.supervisor is not None:
        m = state.supervisor.metrics()
        totals = m.get("totals", {}) or {}
        gauge("mesh_supervisor_uptime_seconds",
              float(m.get("supervisor_uptime_seconds", 0)),
              "Seconds since the supervisor started.")
        gauge("mesh_supervisor_children_total", float(totals.get("children", 0)),
              "Number of supervised children currently tracked.")
        gauge("mesh_supervisor_children_running", float(totals.get("running", 0)),
              "Children currently in the running state.")
        gauge("mesh_supervisor_children_draining", float(totals.get("draining", 0)),
              "Children currently being drained.")
        gauge("mesh_supervisor_children_failed", float(totals.get("failed", 0)),
              "Children currently in the failed state.")
        gauge("mesh_supervisor_restarts_total", float(totals.get("restarts", 0)),
              "Cumulative supervised-process restarts since supervisor started.")
        for child in m.get("children", []):
            labels = {"node_id": child.get("node_id", "?"),
                      "status": child.get("status", "?")}
            gauge("mesh_supervisor_child_uptime_seconds",
                  float(child.get("uptime_seconds", 0)),
                  "Per-child uptime in seconds (0 when not running).",
                  labels=labels)
            gauge("mesh_supervisor_child_restart_total",
                  float(child.get("restart_count_total", 0)),
                  "Per-child cumulative restart count.",
                  labels=labels)
            gauge("mesh_supervisor_child_in_flight",
                  float(child.get("in_flight", 0)),
                  "Per-child currently in-flight invocations.",
                  labels=labels)

    body = "\n".join(lines) + "\n"
    return web.Response(
        body=body.encode("utf-8"),
        headers={"Content-Type": "text/plain; version=0.0.4; charset=utf-8"},
    )


def _prom_escape(value: str) -> str:
    # Per the Prometheus exposition format, label values must escape `\`,
    # `"`, and newline.
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


@web.middleware
async def _cors_middleware(request: web.Request, handler):
    if request.method == "OPTIONS":
        return web.Response(status=204, headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        })
    response = await handler(request)
    if request.path.startswith("/v0/admin"):
        response.headers.setdefault("Access-Control-Allow-Origin", "*")
        response.headers.setdefault("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token")
    return response


class _AdminRateLimiter:
    """Token-bucket rate limiter scoped to ``/v0/admin/*``.

    Generic protocol-layer protection: any caller of the admin namespace —
    operator script, dashboard, malicious neighbour — sees the same bucket.
    Configured via ``MESH_ADMIN_RATE_LIMIT`` (per-minute fill rate,
    default 60) and ``MESH_ADMIN_RATE_BURST`` (bucket capacity / burst
    allowance, default 20). Setting the rate to ``0`` disables limiting.
    """

    def __init__(self, rate_per_min: float, burst: float):
        self.refill_per_sec = rate_per_min / 60.0 if rate_per_min > 0 else 0.0
        self.capacity = float(burst) if burst > 0 else 0.0
        self.enabled = self.refill_per_sec > 0 and self.capacity > 0
        self._buckets: dict[str, tuple[float, float]] = {}
        self._lock = asyncio.Lock()

    async def consume(self, key: str) -> bool:
        if not self.enabled:
            return True
        now = time.monotonic()
        async with self._lock:
            tokens, last = self._buckets.get(key, (self.capacity, now))
            tokens = min(self.capacity, tokens + (now - last) * self.refill_per_sec)
            if tokens < 1.0:
                self._buckets[key] = (tokens, now)
                return False
            tokens -= 1.0
            if len(self._buckets) > ADMIN_RATE_BUCKET_MAX:
                self._evict_idle(now)
            self._buckets[key] = (tokens, now)
            return True

    def _evict_idle(self, now: float) -> None:
        # Drop entries that have refilled to capacity — equivalent to "no
        # state worth keeping". Keeps the dict bounded even under spray.
        idle_after = self.capacity / self.refill_per_sec if self.refill_per_sec else 0
        cutoff = now - idle_after
        for k in [k for k, (_, last) in self._buckets.items() if last < cutoff]:
            self._buckets.pop(k, None)


def _build_admin_rate_limiter(config: Config) -> _AdminRateLimiter:
    return _AdminRateLimiter(config.admin.rate_limit, config.admin.rate_burst)


def _admin_rate_key(request: web.Request) -> str:
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",", 1)[0].strip()
    peer = request.transport.get_extra_info("peername") if request.transport else None
    if peer:
        return peer[0]
    return "unknown"


@web.middleware
async def _admin_rate_limit_middleware(request: web.Request, handler):
    if not request.path.startswith("/v0/admin"):
        return await handler(request)
    if request.method == "OPTIONS":
        return await handler(request)
    limiter: _AdminRateLimiter | None = request.app.get("admin_rate_limiter")
    if limiter is None or not limiter.enabled:
        return await handler(request)
    key = _admin_rate_key(request)
    if not await limiter.consume(key):
        return web.json_response(
            {"error": "rate_limited", "scope": "admin"},
            status=429,
            headers={"Retry-After": "1"},
        )
    return await handler(request)


# ---------- bootstrap ----------

def make_app(
    manifest_path: str,
    audit_path: str | None = None,
    *,
    enable_supervisor: bool | None = None,
    supervisor_log_dir: str | None = None,
    config: Config | None = None,
) -> web.Application:
    if config is None:
        # No explicit config: build one with env-var precedence so legacy
        # callers (tests, in-process embedders) keep working unchanged.
        config = load_config(toml_path=None)
    # Caller-explicit args trump config (back-compat for in-process embedders).
    if audit_path is None:
        audit_path = config.logging.audit_log_path
    if enable_supervisor is None:
        enable_supervisor = config.supervisor.enabled
    if supervisor_log_dir is None:
        supervisor_log_dir = config.supervisor.log_dir
    # Validate the admin token at boot — refusing to start with an unset or
    # legacy-default token. The token is then resolved per-request.
    admin_token()
    app = web.Application(
        client_max_size=10 * 1024 * 1024,
        middlewares=[_cors_middleware, _admin_rate_limit_middleware],
    )
    app["admin_rate_limiter"] = _build_admin_rate_limiter(config)
    state = CoreState(manifest_path, audit_path, config=config)
    state.load_manifest()
    if enable_supervisor:
        repo_root = state.manifest_path.parent.parent  # manifests/foo.yaml -> repo
        # If manifest is at repo/manifests/x.yaml, repo_root is correct.
        # If manifest is somewhere weirder, fall back to cwd.
        if not (repo_root / "scripts").exists():
            repo_root = pathlib.Path.cwd()
        resolver = make_script_resolver(str(repo_root), supervisor_log_dir)

        async def emit_supervisor_event(evt: dict) -> None:
            # Pipe into the admin SSE tail so the dashboard sees live process events.
            payload = {"type": "supervisor", "data": evt}
            for q in list(state._admin_streams):  # noqa: SLF001
                try:
                    q.put_nowait(payload)
                except asyncio.QueueFull:
                    pass

        state.supervisor = Supervisor(
            runner_resolver=resolver,
            log_dir=supervisor_log_dir,
            on_event=emit_supervisor_event,
        )
    app["state"] = state
    app.router.add_post("/v0/register", handle_register)
    app.router.add_post("/v0/invoke", handle_invoke)
    app.router.add_post("/v0/respond", handle_respond)
    app.router.add_get("/v0/stream", handle_stream)
    app.router.add_get("/v0/healthz", handle_health)
    app.router.add_get("/v0/introspect", handle_introspect)
    # SPEC §4.5: only two operator endpoints remain. State, manifest, reload,
    # processes, supervisor lifecycle, and synthesised invoke all moved to
    # core.<surface> and travel /v0/invoke.
    app.router.add_get("/v0/admin/stream", handle_admin_stream)
    app.router.add_get("/v0/admin/metrics", handle_admin_metrics)

    async def on_shutdown(app: web.Application) -> None:
        if state.supervisor is not None:
            try:
                await state.supervisor.shutdown_all(timeout=5.0)
            except Exception:
                pass
        for q in list(state._streams):  # noqa: SLF001
            try:
                q.put_nowait({"type": "_close", "data": {}})
            except asyncio.QueueFull:
                pass

    app.on_shutdown.append(on_shutdown)
    return app


async def amain(config: Config) -> None:
    app = make_app(
        config.server.manifest_path,
        config.logging.audit_log_path,
        enable_supervisor=config.supervisor.enabled,
        supervisor_log_dir=config.supervisor.log_dir,
        config=config,
    )
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, config.server.host, config.server.port)
    await site.start()
    sup_msg = " supervisor=on" if config.supervisor.enabled else ""
    print(
        f"[core] listening on http://{config.server.host}:{config.server.port}  "
        f"manifest={config.server.manifest_path}{sup_msg}",
        flush=True,
    )

    state: CoreState = app["state"]

    if config.supervisor.enabled and config.supervisor.auto_reconcile \
            and state.supervisor is not None:
        # Boot every node declared in the manifest immediately. The supervisor
        # will restart any that crash. This makes Core a self-contained mesh
        # bootstrap: `python -m core.core --supervisor --auto-reconcile` brings
        # the entire mesh up and keeps it up.
        await asyncio.sleep(0.2)  # give the listener a beat to start accepting registrations
        result = await state.supervisor.reconcile(state.manifest_nodes_raw)
        print(f"[core] auto-reconcile: {json.dumps(result['actions'])}", flush=True)

    stop = asyncio.Event()
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass
    await stop.wait()
    print("[core] shutting down", flush=True)
    await runner.cleanup()


def _resolve_config_path(cli_value: str | None) -> str | None:
    if cli_value:
        return cli_value
    env_value = os.environ.get("MESH_CONFIG")
    if env_value:
        return env_value
    for candidate in ("mesh.toml", "configs/mesh.toml"):
        if pathlib.Path(candidate).exists():
            return candidate
    return None


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="RAVEN Mesh Core")
    # Config file controls. CLI defaults are None for migrated flags so the
    # config loader can distinguish "not set on command line" from a default.
    p.add_argument(
        "--config",
        default=None,
        help="Path to mesh.toml. Falls back to $MESH_CONFIG, then ./mesh.toml, "
             "then ./configs/mesh.toml.",
    )
    p.add_argument(
        "--dump-config",
        action="store_true",
        help="Print resolved config (with per-field source attribution) and exit.",
    )
    p.add_argument("--manifest", default=None)
    p.add_argument("--host", default=None)
    p.add_argument("--port", type=int, default=None)
    p.add_argument("--audit-log", default=None)
    p.add_argument(
        "--supervisor",
        action="store_true",
        default=None,
        help="Enable the in-core process supervisor (own node lifecycle).",
    )
    p.add_argument("--supervisor-log-dir", default=None)
    p.add_argument(
        "--auto-reconcile",
        action="store_true",
        default=None,
        help="With --supervisor: spawn all manifest nodes at startup.",
    )
    args = p.parse_args(argv)

    toml_path = _resolve_config_path(args.config)
    config = load_config(toml_path=toml_path, env=os.environ, cli_args=args)

    if args.dump_config:
        sys.stdout.write(dump_config_toml(config))
        return 0

    if not config.server.manifest_path:
        sys.stderr.write(
            "error: no manifest specified. Pass --manifest <path>, set "
            "MESH_MANIFEST, or define server.manifest_path in mesh.toml.\n"
        )
        return 2

    try:
        asyncio.run(amain(config))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())

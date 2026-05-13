"""Strict manifest validation.

Pure function: takes a parsed manifest dict and the directory the manifest was
loaded from (for resolving relative schema paths), returns
``(errors, warnings)`` — two lists of human-readable strings.

This module never raises. A malformed manifest produces error strings; the
caller decides whether to abort, log, or proceed.

Checks performed:

Schema-level (errors):
    * Manifest matches the JSON Schema at ``schemas/manifest.json``
      (nodes is a list, each node has required fields, etc.)

Node-level (errors):
    * Duplicate node IDs.
    * Reserved node IDs: ``core`` is reserved for Core's future self-surfaces.
    * Surface names that collide within a single node.
    * Surface schema file does not exist.
    * Surface schema file does not parse as JSON.

Relationship-level (errors):
    * ``from`` references an undeclared node.
    * ``to`` is not of the form ``node.surface`` (handled by JSON Schema).
    * ``to`` references an undeclared target node.
    * ``to`` references a target surface that doesn't exist on the target node.

Identity (warnings — non-fatal):
    * ``identity_secret: env:VAR`` where ``VAR`` is unset in the environment.
      Core will autogenerate one, but the operator likely meant to set it.
"""
from __future__ import annotations

import json
import os
import pathlib
from typing import Any

from jsonschema import Draft7Validator


_RESERVED_NODE_IDS: frozenset[str] = frozenset({"core"})

# SPEC §5.1: the built-in ``core`` node is always implicitly declared, with
# this fixed surface set. Manifests may reference ``core.<surface>`` as a
# relationship target without redeclaring the node — and they MUST NOT
# redeclare it (see ``_RESERVED_NODE_IDS`` above).
_CORE_BUILTIN_SURFACES: frozenset[str] = frozenset({
    "state", "processes", "metrics", "audit_query",
    "set_manifest", "reload_manifest",
    "spawn", "stop", "restart", "reconcile", "drain",
})

# The JSON Schema lives next to the other schemas at <repo>/schemas/manifest.json.
_SCHEMA_PATH = pathlib.Path(__file__).resolve().parent.parent / "schemas" / "manifest.json"


def _load_manifest_schema() -> dict[str, Any]:
    return json.loads(_SCHEMA_PATH.read_text())


def validate_manifest(
    manifest: Any,
    manifest_dir: str | os.PathLike[str],
    *,
    env: dict[str, str] | None = None,
) -> tuple[list[str], list[str]]:
    """Validate a parsed manifest. Returns ``(errors, warnings)``.

    ``manifest`` is the YAML-parsed object (typically a dict).
    ``manifest_dir`` is the directory the manifest YAML lives in; relative
    surface schema paths are resolved against it.
    ``env`` defaults to ``os.environ`` and is only used to check whether
    ``identity_secret: env:VAR`` references resolve.
    """
    errors: list[str] = []
    warnings: list[str] = []

    if env is None:
        env = dict(os.environ)

    if not isinstance(manifest, dict):
        errors.append(
            f"manifest must be a YAML mapping at the top level, got "
            f"{type(manifest).__name__}"
        )
        return errors, warnings

    # ---- Schema validation ------------------------------------------------
    try:
        schema = _load_manifest_schema()
    except (OSError, json.JSONDecodeError) as e:
        errors.append(f"failed to load manifest schema {_SCHEMA_PATH}: {e}")
        return errors, warnings

    validator = Draft7Validator(schema)
    schema_errors = sorted(validator.iter_errors(manifest), key=lambda e: list(e.absolute_path))
    for err in schema_errors:
        path = "/".join(str(p) for p in err.absolute_path) or "<root>"
        errors.append(f"schema: {path}: {err.message}")

    # If the top-level shape is broken, deeper checks are unsafe.
    nodes = manifest.get("nodes")
    if not isinstance(nodes, list):
        return errors, warnings

    manifest_dir_path = pathlib.Path(manifest_dir)

    declared_ids: set[str] = set()
    surfaces_by_node: dict[str, set[str]] = {}

    # ---- Node-level checks -----------------------------------------------
    for idx, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue  # already reported by schema validation
        nid = node.get("id")
        if not isinstance(nid, str) or not nid:
            continue  # already reported by schema validation

        if nid in _RESERVED_NODE_IDS:
            errors.append(
                f"node[{idx}].id: '{nid}' is reserved for the Core broker "
                f"(see SPEC §5.1); pick a different node id"
            )
        # Even if the schema pattern catches dots/slashes, repeat the check
        # explicitly so error messages are operator-readable.
        if "." in nid or "/" in nid:
            errors.append(
                f"node[{idx}].id: '{nid}' must not contain '.' or '/' "
                f"(use letters, digits, underscore, hyphen)"
            )

        if nid in declared_ids:
            errors.append(f"node[{idx}].id: duplicate node id '{nid}'")
        else:
            declared_ids.add(nid)

        # Surfaces: name collisions, schema file existence, schema parse.
        seen_surface_names: set[str] = set()
        node_surface_names: set[str] = set()
        for sidx, surface in enumerate(node.get("surfaces", []) or []):
            if not isinstance(surface, dict):
                continue
            sname = surface.get("name")
            if isinstance(sname, str) and sname:
                if sname in seen_surface_names:
                    errors.append(
                        f"node '{nid}'.surfaces[{sidx}]: duplicate surface "
                        f"name '{sname}'"
                    )
                else:
                    seen_surface_names.add(sname)
                    node_surface_names.add(sname)

            schema_ref = surface.get("schema")
            if isinstance(schema_ref, str) and schema_ref:
                schema_path = (manifest_dir_path / schema_ref).resolve()
                if not schema_path.exists():
                    errors.append(
                        f"node '{nid}'.surfaces[{sidx}] ('{sname}'): schema "
                        f"file not found: {schema_ref}"
                    )
                else:
                    try:
                        json.loads(schema_path.read_text())
                    except (OSError, json.JSONDecodeError) as e:
                        errors.append(
                            f"node '{nid}'.surfaces[{sidx}] ('{sname}'): "
                            f"schema file failed to parse: {schema_ref}: {e}"
                        )

        surfaces_by_node[nid] = node_surface_names

        # identity_secret: env:VAR — warn (do not fail) if unresolvable.
        secret_spec = node.get("identity_secret")
        if isinstance(secret_spec, str) and secret_spec.startswith("env:"):
            var = secret_spec[4:]
            if not var:
                errors.append(
                    f"node '{nid}'.identity_secret: 'env:' with no variable name"
                )
            elif var not in env or not env.get(var):
                warnings.append(
                    f"node '{nid}'.identity_secret: env var '{var}' is unset; "
                    f"Core will autogenerate a secret and set it"
                )

    # ---- Relationship-level checks ---------------------------------------
    relationships = manifest.get("relationships") or []
    if not isinstance(relationships, list):
        return errors, warnings

    for ridx, rel in enumerate(relationships):
        if not isinstance(rel, dict):
            continue
        rfrom = rel.get("from")
        rto = rel.get("to")

        if isinstance(rfrom, str) and rfrom and rfrom not in declared_ids:
            errors.append(
                f"relationships[{ridx}]: 'from' references undeclared node "
                f"'{rfrom}'"
            )

        if not (isinstance(rto, str) and "." in rto):
            # Already reported by the schema check.
            continue
        target_node, _, surface_name = rto.partition(".")
        # SPEC §5.1: 'core' is always present implicitly; resolve against the
        # built-in surface set rather than `declared_ids`.
        if target_node == "core":
            if surface_name not in _CORE_BUILTIN_SURFACES:
                errors.append(
                    f"relationships[{ridx}]: 'core' has no surface "
                    f"'{surface_name}' (in '{rto}'); valid: "
                    f"{sorted(_CORE_BUILTIN_SURFACES)}"
                )
            continue
        if target_node not in declared_ids:
            errors.append(
                f"relationships[{ridx}]: 'to' references undeclared node "
                f"'{target_node}' (in '{rto}')"
            )
            continue
        if surface_name not in surfaces_by_node.get(target_node, set()):
            errors.append(
                f"relationships[{ridx}]: surface '{surface_name}' does not "
                f"exist on node '{target_node}' (in '{rto}')"
            )

    return errors, warnings

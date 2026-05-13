"""Mesh client for raven-core.

raven registers with Core as the `raven` node on orchestrator startup
and uses the resulting session to dispatch invocations to other mesh
nodes. Outbound-only: no surfaces are registered, no .on() handlers are
attached, no SSE stream is opened. Tools that need homeOS data or
capabilities (notify, future news/finance/agents) call into
``mesh_invoke`` rather than embedding their implementation directly.

Lifecycle:
- ``setup()`` is awaited from Orchestrator.run() before Gemini Live
  starts taking input. It instantiates the node, opens an aiohttp
  session, and POSTs /v0/register. If MESH_CORE_URL / MESH_RAVEN_SECRET
  are unset (e.g. raven launched standalone outside the homeOS shell),
  setup logs a warning and returns; subsequent ``mesh_invoke`` calls
  raise MeshUnavailable so the tool layer can surface a clean error to
  Gemini rather than crashing the orchestrator.
- ``shutdown()`` closes the aiohttp session. Called from the
  orchestrator's finally block.

The vendored SDK ships at ``core/node_sdk/``. The shell's
ravenDaemonManager prepends ``<repo>/core`` (the SDK package's parent
directory) to PYTHONPATH at spawn time, so ``from node_sdk import
MeshNode`` resolves to ``core/node_sdk/__init__.py``. See
shell/electron/main/services/ravenDaemonManager.ts.
"""
from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger("raven.mesh_client")


class MeshUnavailable(Exception):
    """Raised by mesh_invoke when the client never came up (e.g. env unset)."""


# Module-level singletons. We only ever have one mesh client per
# raven-core process, and tools reach it via the module-level
# mesh_invoke function — no need for a class with explicit DI.
_node: Any = None  # MeshNode instance once setup() completes
_setup_attempted: bool = False
_setup_reason: str | None = None  # populated if setup failed/skipped


async def setup() -> bool:
    """Initialise the mesh node and register with Core.

    Returns True if the node is live and ready to invoke; False if the
    setup was skipped (env vars unset) or failed. On False the
    orchestrator continues with raven-internal tools (time, memory)
    intact — only mesh-routed tools (notify) will surface errors.
    """
    global _node, _setup_attempted, _setup_reason

    if _setup_attempted:
        return _node is not None
    _setup_attempted = True

    core_url = os.environ.get("MESH_CORE_URL")
    secret = os.environ.get("MESH_RAVEN_SECRET")
    if not core_url or not secret:
        _setup_reason = "MESH_CORE_URL / MESH_RAVEN_SECRET unset"
        log.warning(
            "[mesh_client] %s — mesh-routed tools will be unavailable; "
            "raven-internal tools (time, memory) still work.",
            _setup_reason,
        )
        return False

    try:
        # Imported lazily so a missing SDK on PYTHONPATH surfaces here
        # with a clear log line rather than crashing module import at
        # process start. The package directory is `core/node_sdk`; the
        # shell's ravenDaemonManager puts `core/` (its parent) on
        # PYTHONPATH so the package imports as `node_sdk`.
        from node_sdk import MeshNode  # type: ignore[import-not-found]
    except ImportError as e:
        _setup_reason = f"node_sdk import failed: {e}"
        log.warning("[mesh_client] %s", _setup_reason)
        return False

    node = MeshNode(node_id="raven", secret=secret, core_url=core_url)
    try:
        # connect() opens the aiohttp session and POSTs /v0/register.
        # It does NOT open the SSE stream — that's serve()'s job, and
        # raven has no inbound surfaces so the stream would carry only
        # heartbeats. Skipping it saves a long-lived connection +
        # background dispatch task.
        await node.connect()
    except Exception as e:  # MeshError, aiohttp errors, etc.
        _setup_reason = f"mesh register failed: {e}"
        log.warning("[mesh_client] %s", _setup_reason)
        try:
            await node.stop()
        except Exception:
            pass
        return False

    _node = node
    log.info("[mesh_client] registered as 'raven' with Core at %s", core_url)
    return True


async def mesh_invoke(target: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Dispatch an invocation to ``target`` (e.g. "host_notifications.notify").

    Returns the response payload from the remote node on success.
    Raises ``MeshUnavailable`` if setup never produced a live node.
    Any error response from Core (auth, denied edge, remote handler
    exception) is also raised as MeshUnavailable with the reason
    attached, so callers have a single exception class to catch.
    """
    if _node is None:
        raise MeshUnavailable(_setup_reason or "mesh client not initialised")

    try:
        env = await _node.invoke(target, payload)
    except Exception as e:
        # MeshError (Core returned non-2xx), aiohttp ClientError, etc.
        raise MeshUnavailable(f"invoke failed: {e}") from e

    # Core returns the full envelope on synchronous request/response.
    # An error kind means the target node (or Core itself) refused —
    # surface the reason so the tool layer can hand a useful structured
    # error back to Gemini.
    kind = env.get("kind")
    if kind == "error":
        reason = env.get("payload", {}).get("reason", "remote_error")
        raise MeshUnavailable(f"mesh error: {reason}")
    return env.get("payload", {}) if isinstance(env.get("payload"), dict) else {}


async def shutdown() -> None:
    """Close the aiohttp session held by the mesh node."""
    global _node
    if _node is None:
        return
    try:
        await _node.stop()
    except Exception as e:
        log.warning("[mesh_client] stop failed: %s", e)
    _node = None


def is_available() -> bool:
    """Cheap check used by tools to decide whether to even attempt invoke."""
    return _node is not None

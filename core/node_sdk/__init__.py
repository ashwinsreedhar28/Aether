"""Tiny Python client for the RAVEN Mesh wire protocol.

Usage:
    node = MeshNode(
        node_id="tasks",
        secret=os.environ["TASKS_SECRET"],
        core_url="http://127.0.0.1:8000",
    )
    node.on("create", create_handler)
    node.on("list", list_handler)
    await node.start()
    ...
    await node.stop()

Handler return-value contract:
    - dict       -> sent as a response envelope (kind="response").
    - None       -> no response sent (intended for fire_and_forget inboxes).
    - raise MeshDeny(reason, **details) -> sent as kind="error".
    - any other exception -> caught, sent as kind="error" with handler_exception.

Invocations:
    await node.invoke("tasks.list", {})            # request/response
    await node.invoke("inbox.x", {...}, wrapped=original_env)
    await node.invoke("inbox.x", {...}, wait=False) # 202 fire-and-forget
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import hashlib
import hmac
import json
import logging
import uuid
from typing import Any, Awaitable, Callable

import aiohttp

log = logging.getLogger("mesh.node")

Handler = Callable[[dict], Awaitable[Any]]


def now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def canonical(obj: dict) -> str:
    """Serialize an envelope deterministically for HMAC signing.

    The ``signature`` field is excluded so signing is reproducible.
    """
    body = {k: v for k, v in obj.items() if k != "signature"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)


def sign(obj: dict, secret: str) -> str:
    """Compute the HMAC-SHA256 signature of ``obj`` with ``secret``."""
    return hmac.new(secret.encode(), canonical(obj).encode(), hashlib.sha256).hexdigest()


class MeshError(Exception):
    """Raised when Core returns a non-2xx HTTP status to a node call."""

    def __init__(self, status: int, data: Any):
        self.status = status
        self.data = data
        super().__init__(f"mesh error {status}: {data}")


class MeshDeny(Exception):
    """Raised by a handler to send back a structured ``error`` envelope."""

    def __init__(self, reason: str, **details: Any):
        self.reason = reason
        self.details = details
        super().__init__(reason)


class MeshNode:
    """Mesh client: registers with Core, streams deliveries, dispatches handlers."""

    def __init__(
        self,
        node_id: str,
        secret: str,
        core_url: str,
        *,
        invoke_timeout: float = 30.0,
    ):
        self.node_id = node_id
        self.secret = secret
        self.core_url = core_url.rstrip("/")
        self.invoke_timeout = invoke_timeout
        self.session_id: str | None = None
        self.relationships: list[dict] = []
        self.surfaces: list[dict] = []
        self.handlers: dict[str, Handler] = {}
        self._http: aiohttp.ClientSession | None = None
        self._stream_task: asyncio.Task | None = None
        self._dispatch_tasks: set[asyncio.Task] = set()
        self._ready = asyncio.Event()

    # public ------------------------------------------------------------

    def on(self, surface_name: str, handler: Handler) -> None:
        """Register an async ``handler(envelope) -> dict | None`` for a surface."""
        self.handlers[surface_name] = handler

    async def connect(self) -> None:
        """Register with Core. Populates self.surfaces / self.relationships."""
        if self._http is None:
            self._http = aiohttp.ClientSession()
        await self._register()

    async def serve(self) -> None:
        """Open the SSE stream and begin dispatching deliver events."""
        if self._http is None:
            await self.connect()
        if self._stream_task is None:
            self._stream_task = asyncio.create_task(self._stream_loop())
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            log.warning("[%s] stream did not signal hello within 5s", self.node_id)

    async def start(self) -> None:
        """Connect to Core and begin streaming deliveries (``connect`` + ``serve``)."""
        await self.connect()
        await self.serve()

    async def stop(self) -> None:
        """Cancel the stream and dispatch tasks and close the HTTP session."""
        if self._stream_task:
            self._stream_task.cancel()
            try:
                await self._stream_task
            except (asyncio.CancelledError, Exception):
                pass
            self._stream_task = None
        for t in list(self._dispatch_tasks):
            t.cancel()
        if self._http:
            await self._http.close()
            self._http = None

    async def invoke(
        self,
        target_surface: str,
        payload: dict,
        *,
        wait: bool = True,
        wrapped: dict | None = None,
        correlation_id: str | None = None,
    ) -> dict:
        """Send an invocation envelope to ``target_surface`` and return the response.

        With ``wait=False`` Core returns 202 and this returns ``{"status":"accepted"}``.
        """
        env = self._build_envelope("invocation", target_surface, payload,
                                    correlation_id=correlation_id, wrapped=wrapped)
        timeout = aiohttp.ClientTimeout(total=self.invoke_timeout + 5 if wait else 10)
        assert self._http is not None
        async with self._http.post(f"{self.core_url}/v0/invoke", json=env, timeout=timeout) as r:
            data = await r.json()
            if r.status == 202:
                return {"status": "accepted", "id": env["id"]}
            if r.status != 200:
                raise MeshError(r.status, data)
            return data

    async def respond(self, original: dict, payload: dict, *, kind: str = "response") -> None:
        """Send a ``response`` (or ``error``) envelope correlated to ``original``."""
        msg_id = str(uuid.uuid4())
        env = {
            "id": msg_id,
            "correlation_id": original.get("id"),
            "from": self.node_id,
            "to": original.get("from", ""),
            "kind": kind,
            "payload": payload,
            "timestamp": now_iso(),
        }
        env["signature"] = sign(env, self.secret)
        assert self._http is not None
        async with self._http.post(f"{self.core_url}/v0/respond", json=env) as r:
            data = await r.json()
            if r.status != 200:
                raise MeshError(r.status, data)

    # internals ---------------------------------------------------------

    def _build_envelope(self, kind: str, to: str, payload: dict, *,
                        correlation_id: str | None = None,
                        wrapped: dict | None = None) -> dict:
        msg_id = str(uuid.uuid4())
        env = {
            "id": msg_id,
            "correlation_id": correlation_id or msg_id,
            "from": self.node_id,
            "to": to,
            "kind": kind,
            "payload": payload,
            "timestamp": now_iso(),
        }
        if wrapped is not None:
            env["wrapped"] = wrapped
        env["signature"] = sign(env, self.secret)
        return env

    async def _register(self) -> None:
        body: dict[str, Any] = {
            "node_id": self.node_id,
            "timestamp": now_iso(),
        }
        body["signature"] = sign(body, self.secret)
        assert self._http is not None
        async with self._http.post(f"{self.core_url}/v0/register", json=body) as r:
            data = await r.json()
            if r.status != 200:
                raise MeshError(r.status, data)
        self.session_id = data["session_id"]
        self.relationships = data["relationships"]
        self.surfaces = data["surfaces"]
        log.info("[%s] registered. session=%s surfaces=%d edges=%d",
                 self.node_id, self.session_id, len(self.surfaces), len(self.relationships))

    async def _stream_loop(self) -> None:
        url = f"{self.core_url}/v0/stream?session={self.session_id}"
        timeout = aiohttp.ClientTimeout(total=None, sock_read=None)
        try:
            assert self._http is not None
            async with self._http.get(url, timeout=timeout) as r:
                if r.status != 200:
                    log.error("[%s] stream rejected: %s", self.node_id, r.status)
                    return
                event_type: str | None = None
                data_lines: list[str] = []
                while True:
                    raw = await r.content.readline()
                    if not raw:
                        break
                    line = raw.decode("utf-8").rstrip("\r\n")
                    if line == "":
                        if event_type and data_lines:
                            data_str = "\n".join(data_lines)
                            try:
                                data = json.loads(data_str)
                            except json.JSONDecodeError:
                                data = data_str
                            if event_type == "hello":
                                self._ready.set()
                            elif event_type == "deliver":
                                t = asyncio.create_task(self._dispatch(data))
                                self._dispatch_tasks.add(t)
                                t.add_done_callback(self._dispatch_tasks.discard)
                        event_type = None
                        data_lines = []
                        continue
                    if line.startswith(":"):
                        continue
                    if line.startswith("event:"):
                        event_type = line[6:].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line[5:].lstrip())
        except asyncio.CancelledError:
            return
        except Exception as e:
            log.warning("[%s] stream loop ended: %s", self.node_id, e)

    async def _dispatch(self, env: dict) -> None:
        to = env.get("to", "")
        surface_name = to.split(".", 1)[1] if "." in to else to
        handler = self.handlers.get(surface_name)
        surface = next((s for s in self.surfaces if s.get("name") == surface_name), None)
        mode = surface.get("invocation_mode", "request_response") if surface else "request_response"
        if not handler:
            if mode != "fire_and_forget":
                try:
                    await self.respond(env, {"reason": "no_handler", "surface": surface_name}, kind="error")
                except Exception as e:
                    log.warning("[%s] respond failed: %s", self.node_id, e)
            return
        try:
            result = await handler(env)
        except MeshDeny as d:
            if mode != "fire_and_forget":
                try:
                    await self.respond(env, {"reason": d.reason, **d.details}, kind="error")
                except Exception as e:
                    log.warning("[%s] respond(error) failed: %s", self.node_id, e)
            return
        except Exception as e:
            log.exception("[%s] handler raised", self.node_id)
            if mode != "fire_and_forget":
                try:
                    await self.respond(env, {"reason": "handler_exception", "details": str(e)}, kind="error")
                except Exception as ee:
                    log.warning("[%s] respond(error) failed: %s", self.node_id, ee)
            return
        if mode == "fire_and_forget":
            return
        if result is None:
            return
        try:
            await self.respond(env, result)
        except Exception as e:
            log.warning("[%s] respond failed: %s", self.node_id, e)

"""Shared SSE plumbing for node inspector UIs.

Every node that exposes a `/events` stream historically reimplemented the
same loop: open a `text/event-stream`, register a per-connection
`asyncio.Queue`, replay any cached state, drain the queue with a heartbeat
fallback, swallow `ConnectionResetError` on disconnect, and unregister the
queue. One bug fixed in one place left the rest broken. This module
extracts that loop.

Design:

- `SSEHub` owns the set of subscribers (one queue per connected client).
  Producers call `hub.broadcast(name, data)`; the hub fans out non-blocking
  `put_nowait` to every queue and drops on `QueueFull` rather than blocking
  the producer.

- `serve_sse(request, hub, replay=...)` takes over the request, prepares
  the response, replays any seed events, then drains the queue forever
  with a heartbeat fallback and survives client disconnects cleanly.

- Last-Event-ID resume is supported when the producer attaches optional
  ids to events. If no ids are attached, replay is whole-buffer.

Wire format is preserved verbatim from the legacy node implementations:

    event: <name>\\ndata: <json>\\n\\n
    : heartbeat\\n\\n   (every `heartbeat_seconds` of idle)
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Iterable

from aiohttp import web

log = logging.getLogger("node_sdk.inspector.sse")


# An item flowing through a subscriber queue or replay buffer.
# Either a 2-tuple (event_name, data) or 3-tuple (event_name, data, event_id).
SSEItem = tuple


def _normalize(item: SSEItem) -> tuple[str, Any, str | None]:
    if len(item) == 3:
        return item[0], item[1], item[2]
    if len(item) == 2:
        return item[0], item[1], None
    raise ValueError(f"SSE item must be (name, data) or (name, data, id); got len={len(item)}")


def _format(name: str, data: Any, event_id: str | None) -> bytes:
    chunks = []
    if event_id is not None:
        chunks.append(f"id: {event_id}")
    chunks.append(f"event: {name}")
    chunks.append(f"data: {json.dumps(data, default=str)}")
    return ("\n".join(chunks) + "\n\n").encode()


class SSEHub:
    """Fan-out hub: producers broadcast, each connection drains its own queue.

    Subscribers are `asyncio.Queue` instances holding `(name, data)` or
    `(name, data, id)` tuples. The hub never blocks the producer — if a
    subscriber's queue is full, that event is dropped for that subscriber
    only.
    """

    def __init__(self) -> None:
        self._subs: set[asyncio.Queue] = set()

    def add_subscriber(self, maxsize: int = 1024) -> asyncio.Queue:
        """Register a new subscriber queue and return it for the connection to drain."""
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        self._subs.add(q)
        return q

    def remove_subscriber(self, q: asyncio.Queue) -> None:
        """Detach a subscriber queue. Idempotent."""
        self._subs.discard(q)

    def broadcast(self, event_name: str, data: Any, event_id: str | None = None) -> None:
        """Push an event to every subscriber. Drops the event for full queues."""
        item: SSEItem = (event_name, data, event_id) if event_id is not None else (event_name, data)
        for q in list(self._subs):
            try:
                q.put_nowait(item)
            except asyncio.QueueFull:
                # Slow consumer — drop this event for them, keep the connection.
                pass

    def __len__(self) -> int:
        return len(self._subs)


ReplayProvider = Iterable[SSEItem] | Callable[[], Iterable[SSEItem]]


async def serve_sse(
    request: web.Request,
    hub: SSEHub,
    *,
    replay: ReplayProvider | None = None,
    heartbeat_seconds: float = 15.0,
    queue_maxsize: int = 1024,
    extra_headers: dict[str, str] | None = None,
) -> web.StreamResponse:
    """Drive an SSE response off `hub` until the client disconnects.

    `replay` is sent before subscribing for live broadcasts. It can be either
    an iterable of `(name, data)` / `(name, data, id)` tuples, or a zero-arg
    callable returning one (the latter lets you snapshot fresh state at
    connect time without holding a stale buffer).

    If the client sent `Last-Event-ID`, replay items are skipped up to and
    including that id (only effective when items carry ids).
    """
    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
    }
    if extra_headers:
        headers.update(extra_headers)
    response = web.StreamResponse(status=200, headers=headers)
    await response.prepare(request)

    last_event_id = request.headers.get("Last-Event-ID")

    queue = hub.add_subscriber(maxsize=queue_maxsize)
    try:
        if replay is not None:
            items = replay() if callable(replay) else replay
            skipping = last_event_id is not None
            for item in items:
                name, data, eid = _normalize(item)
                if skipping:
                    if eid is not None and eid == last_event_id:
                        skipping = False
                    continue
                try:
                    await response.write(_format(name, data, eid))
                except (ConnectionResetError, BrokenPipeError):
                    return response

        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=heartbeat_seconds)
            except asyncio.TimeoutError:
                try:
                    await response.write(b": heartbeat\n\n")
                except (ConnectionResetError, BrokenPipeError):
                    break
                continue
            name, data, eid = _normalize(item)
            try:
                await response.write(_format(name, data, eid))
            except (ConnectionResetError, BrokenPipeError):
                break
    finally:
        hub.remove_subscriber(queue)
    return response


__all__ = ["SSEHub", "serve_sse"]

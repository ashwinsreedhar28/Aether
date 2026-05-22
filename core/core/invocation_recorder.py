"""In-memory ring buffer of recent broker invocation outcomes.

Sister to ``state.envelope_tail`` (which captures every envelope event with
direction + route_status). This buffer is invocation-shaped: one entry per
``/v0/invoke`` call, with timing + a coarse success/error_kind summary
suitable for live topology display. Consumed by ``/__introspection__``.

Thread-safe. The broker is single-threaded asyncio today, but the supervisor
runs work in executors; a plain ``threading.Lock`` keeps the buffer correct
under any caller.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any, Optional

DEFAULT_CAPACITY = 256


class InvocationRecorder:
    def __init__(self, capacity: int = DEFAULT_CAPACITY) -> None:
        self._buf: deque[dict[str, Any]] = deque(maxlen=capacity)
        self._lock = threading.Lock()
        self._last_seen: dict[str, float] = {}

    def record(
        self,
        *,
        src_node: Optional[str],
        dst_node: Optional[str],
        surface: Optional[str],
        success: bool,
        error_kind: Optional[str],
        latency_ms: float,
        timestamp: Optional[float] = None,
    ) -> None:
        ts = timestamp if timestamp is not None else time.time()
        entry = {
            "ts": ts,
            "src_node": src_node,
            "dst_node": dst_node,
            "surface": surface,
            "success": success,
            "error_kind": error_kind,
            "latency_ms": latency_ms,
        }
        with self._lock:
            self._buf.append(entry)
            if src_node:
                self._last_seen[src_node] = ts
            if dst_node:
                self._last_seen[dst_node] = ts

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._buf)

    def last_seen(self, node_id: str) -> Optional[float]:
        with self._lock:
            return self._last_seen.get(node_id)

    def all_last_seen(self) -> dict[str, float]:
        with self._lock:
            return dict(self._last_seen)

    def __len__(self) -> int:
        with self._lock:
            return len(self._buf)

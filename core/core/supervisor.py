"""
core/supervisor.py — Process supervisor for RAVEN_MESH nodes.

Responsibility: own the lifecycle of node processes declared in the manifest.

The mesh has two layers of state:
  1. DECLARATION (what `core.py` already manages): which nodes exist, their
     surfaces, edges, secrets. Loaded from the manifest yaml.
  2. PROCESSES (this module): actual OS processes running each node. Spawn,
     monitor, restart on crash, hot-add new ones, hot-remove old ones.

Until tonight, layer 2 was the user's job (`scripts/run_mesh.sh`). The
supervisor moves it into Core so editing the manifest can actually start and
stop processes.

Design notes (Python is not BEAM, but we copy the parts we can):
  - One ChildSpec per node_id derived from manifest. The spec contains the
    command, env, log path, and restart policy.
  - One ChildState per running child holds the asyncio.subprocess.Process
    and bookkeeping.
  - Each child has an associated Task that .wait()s on the process and
    handles restart on unexpected exit. (BEAM-style permanent/transient/
    temporary restart strategies, simplified.)
  - reconcile() takes the desired set of node_ids (from manifest) and the
    actual set (from running children) and computes the diff: spawn missing,
    stop extras, leave matching ones alone.
  - The supervisor does NOT decide HOW to start a node. It defers to a
    `runner_resolver` callable that maps node_id -> (cmd, env, cwd). For
    the existing mesh that resolver finds `scripts/run_<node_id>.sh`. For
    future mesh shapes the resolver could check a "runtime" field in the
    manifest (e.g. docker-image vs. local-process).

Why this is a prototype, not the final answer:
  - Python's subprocess + asyncio model has sharp edges (zombie reaping on
    SIGCHLD, signal masks across forks, log fd limits). BEAM solves all of
    these by being process-native.
  - Restart strategies here are basic. OTP's intensity/period throttling and
    one_for_all/rest_for_one strategies are not implemented.
  - We hold the manifest in memory and reconcile on demand. A real
    supervisor reacts to crashes via SIGCHLD; here we poll via subprocess
    .wait() in a per-child task.

Wire: `Supervisor` is owned by `CoreState`. New admin endpoints
  POST /v0/admin/spawn        body: {"node_id": "..."}
  POST /v0/admin/stop         body: {"node_id": "...", "graceful": true}
  POST /v0/admin/restart      body: {"node_id": "..."}
  POST /v0/admin/reconcile    body: {} — diff manifest vs. running, act
  GET  /v0/admin/processes    list of children with pid, status, uptime, restarts

The dashboard can wire a "Save & Reload" button that POSTs the new manifest
to /v0/admin/manifest then POSTs /v0/admin/reconcile. Two calls, real
hot-add / hot-remove.
"""

from __future__ import annotations

import asyncio
import logging
import os
import pathlib
import signal
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

log = logging.getLogger("supervisor")


# ---------- specs and state ----------

@dataclass
class ChildSpec:
    """Static description of how to start a child.

    PROTOCOL-LAYER: this struct is intentionally agnostic of *what* a child
    does (kanban, voice, dashboard, anything). It only describes a process
    lifecycle contract. Don't add node-shaped fields here.
    """
    node_id: str
    cmd: list[str]
    env: dict[str, str]
    cwd: str
    log_path: str
    # Restart policy:
    #   permanent  — always restart on exit
    #   transient  — restart only on abnormal (non-zero) exit
    #   temporary  — never restart automatically
    #   on_demand  — never spawned eagerly; spawned by ensure_running() on
    #                first work, SIGTERMed after idle_shutdown_s of silence
    restart: str = "permanent"
    # Restart throttle: max N restarts in window seconds. Beyond that, the
    # supervisor gives up on the child and marks it 'failed'. Reset by a
    # successful long-lived run (uptime > window).
    max_restarts: int = 5
    restart_window_s: float = 60.0
    # Idle window for restart="on_demand". After this many seconds with no
    # ensure_running()/begin_work() activity, the supervisor SIGTERMs the
    # child and waits for the next ensure_running() to spawn it again.
    # Ignored for other restart strategies.
    idle_shutdown_s: float = 30.0


@dataclass
class ChildState:
    """Mutable runtime state of a supervised child process."""

    spec: ChildSpec
    proc: Optional[asyncio.subprocess.Process] = None
    pid: Optional[int] = None
    started_at: float = 0.0
    last_exit_code: Optional[int] = None
    last_exit_at: float = 0.0
    restart_count: int = 0  # restarts in the current window (for throttling)
    total_restart_count: int = 0  # cumulative across child's life (for /metrics)
    restart_window_start: float = 0.0
    # stopped|starting|running|crashed|failed|stopping|draining
    status: str = "stopped"
    monitor_task: Optional[asyncio.Task] = None
    log_fd = None  # file handle, kept open for the child's life
    # on_demand bookkeeping: when activity last occurred and the reaper task.
    last_activity_at: float = 0.0
    idle_reaper_task: Optional[asyncio.Task] = None
    # Graceful-drain bookkeeping. `in_flight` is a generic counter the
    # dispatcher (Core, or any future caller) increments around each unit
    # of work. The supervisor knows nothing about envelopes — it only
    # waits for the counter to hit zero.
    in_flight: int = 0
    drain_done: Optional[asyncio.Event] = None

    def to_dict(self) -> dict:
        """Serialize child state into a JSON-friendly dict for admin endpoints."""
        uptime = (time.time() - self.started_at) if self.status == "running" else 0.0
        return {
            "node_id": self.spec.node_id,
            "pid": self.pid,
            "status": self.status,
            "uptime_seconds": round(uptime, 1),
            "started_at": self.started_at,
            "last_exit_code": self.last_exit_code,
            "last_exit_at": self.last_exit_at,
            "restart_count": self.restart_count,
            "total_restart_count": self.total_restart_count,
            "in_flight": self.in_flight,
            "log_path": self.spec.log_path,
            "restart_policy": self.spec.restart,
            "cmd": self.spec.cmd,
        }


# ---------- supervisor ----------

# A runner_resolver maps node_id -> ChildSpec (or None if we don't know how to
# start that node — e.g. dummy one-shots). Centralizing this keeps the
# supervisor agnostic of the existing scripts/ layout.
RunnerResolver = Callable[[str, dict], Optional[ChildSpec]]


# PROTOCOL-LAYER: exponential backoff schedule for restart attempts.
# Schedule: 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 30.0 (capped). Capping at 30s
# bounds the worst-case wakeup time after a long crash storm while still
# letting the supervisor stop hammering a flapping child.
_BACKOFF_BASE_S = 0.5
_BACKOFF_CAP_S = 30.0


def _backoff_seconds(attempt: int) -> float:
    """attempt is 1-indexed. Returns exponential backoff capped at 30s."""
    if attempt < 1:
        return 0.0
    return min(_BACKOFF_BASE_S * (2 ** (attempt - 1)), _BACKOFF_CAP_S)


class Supervisor:
    """Process supervisor: spawns, monitors, restarts, and drains child nodes.

    PROTOCOL-LAYER: deliberately knows nothing about envelopes, surfaces, or
    what nodes do — only process lifecycle.
    """

    def __init__(
        self,
        runner_resolver: RunnerResolver,
        log_dir: str = ".logs",
        on_event: Optional[Callable[[dict], Awaitable[None]]] = None,
    ):
        self.runner_resolver = runner_resolver
        self.log_dir = pathlib.Path(log_dir).resolve()
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.children: dict[str, ChildState] = {}
        self.lock = asyncio.Lock()
        self._stopping = False
        self._on_event = on_event
        self.started_at = time.time()

    async def _emit(self, kind: str, **fields) -> None:
        if not self._on_event:
            return
        try:
            await self._on_event({"ts": time.time(), "kind": kind, **fields})
        except Exception as e:  # pragma: no cover
            log.warning("supervisor on_event failed: %s", e)

    # ---- public API used by admin endpoints ----

    async def spawn(self, node_id: str, manifest_node: dict) -> dict:
        """Start a child. No-op (with warning) if already running."""
        async with self.lock:
            existing = self.children.get(node_id)
            if existing and existing.status in ("running", "starting"):
                return {
                    "ok": True,
                    "already_running": True,
                    "child": existing.to_dict(),
                }
            spec = self.runner_resolver(node_id, manifest_node)
            if spec is None:
                return {
                    "ok": False,
                    "error": "no_runner",
                    "details": f"no runner registered for node_id={node_id}",
                }
            return await self._start_locked(spec)

    async def stop(self, node_id: str, graceful: bool = True, timeout: float = 5.0) -> dict:
        """Stop a child. Cancels a pending restart if mid-backoff."""
        async with self.lock:
            child = self.children.get(node_id)
            if not child:
                return {"ok": False, "error": "unknown_node"}
            # If the child is mid-backoff after a crash, cancel the pending
            # restart and mark it stopped. This is not "already stopped" — the
            # monitor task is alive and would respawn if we didn't intervene.
            if child.status == "crashed":
                if child.monitor_task and not child.monitor_task.done():
                    child.monitor_task.cancel()
                child.status = "stopped"
                return {"ok": True, "cancelled_pending_restart": True,
                        "child": child.to_dict()}
            if child.status in ("stopped", "failed"):
                return {"ok": True, "already_stopped": True, "child": child.to_dict()}
            return await self._stop_locked(child, graceful=graceful, timeout=timeout)

    async def restart(self, node_id: str, manifest_node: dict) -> dict:
        """Stop the child if running, then start it from a fresh ChildSpec."""
        async with self.lock:
            child = self.children.get(node_id)
            if child and child.status in ("running", "starting"):
                await self._stop_locked(child, graceful=True, timeout=5.0)
            spec = self.runner_resolver(node_id, manifest_node)
            if spec is None:
                return {"ok": False, "error": "no_runner"}
            return await self._start_locked(spec)

    async def reconcile(self, manifest_nodes: dict[str, dict]) -> dict:
        """Diff manifest desired set vs. running set. Spawn missing, stop extras.

        on_demand children are NOT spawned eagerly — they're listed under
        `deferred` and wait for ensure_running() to wake them.
        """
        actions = {"spawned": [], "stopped": [], "skipped": [],
                   "kept": [], "deferred": [], "errors": []}
        desired_ids = set(manifest_nodes.keys())
        async with self.lock:
            running_ids = {nid for nid, c in self.children.items()
                           if c.status in ("running", "starting")}
            to_spawn = desired_ids - running_ids
            to_stop = running_ids - desired_ids
            to_keep = desired_ids & running_ids

            for nid in to_keep:
                actions["kept"].append(nid)

            for nid in to_spawn:
                spec = self.runner_resolver(nid, manifest_nodes[nid])
                if spec is None:
                    actions["skipped"].append({"node_id": nid, "reason": "no_runner"})
                    continue
                # on_demand children are not spawned during reconcile; they
                # come up the first time ensure_running() is called.
                if spec.restart == "on_demand":
                    actions["deferred"].append(nid)
                    # Record the spec so list_processes() / metrics show it.
                    if nid not in self.children:
                        self.children[nid] = ChildState(spec=spec)
                    continue
                try:
                    res = await self._start_locked(spec)
                    if res.get("ok"):
                        actions["spawned"].append(nid)
                    else:
                        actions["errors"].append({"node_id": nid, "error": res})
                except Exception as e:
                    actions["errors"].append({"node_id": nid, "error": str(e)})

            for nid in to_stop:
                child = self.children.get(nid)
                if not child:
                    continue
                try:
                    await self._stop_locked(child, graceful=True, timeout=5.0)
                    actions["stopped"].append(nid)
                except Exception as e:
                    actions["errors"].append({"node_id": nid, "error": str(e)})

        await self._emit("reconcile", actions=actions)
        return {"ok": True, "actions": actions}

    def list_processes(self) -> list[dict]:
        """Return ``to_dict`` snapshots for every supervised child."""
        return [c.to_dict() for c in self.children.values()]

    # ---- on_demand: lazy spawn + idle reap (PROTOCOL-LAYER, generic) ----

    async def ensure_running(self, node_id: str, manifest_node: dict) -> dict:
        """Spawn the child if it's not already running.

        Used by a dispatcher to wake an `on_demand` child on first work.
        Idempotent for non-on_demand children that are already running.
        Touches `last_activity_at` so the idle reaper sees fresh activity.
        """
        async with self.lock:
            existing = self.children.get(node_id)
            if existing and existing.status in ("running", "starting"):
                existing.last_activity_at = time.time()
                return {"ok": True, "already_running": True,
                        "child": existing.to_dict()}
            spec = self.runner_resolver(node_id, manifest_node)
            if spec is None:
                return {"ok": False, "error": "no_runner"}
            res = await self._start_locked(spec)
            child = self.children.get(node_id)
            if child:
                child.last_activity_at = time.time()
                if (spec.restart == "on_demand"
                        and (child.idle_reaper_task is None
                             or child.idle_reaper_task.done())):
                    child.idle_reaper_task = asyncio.create_task(
                        self._idle_reaper(child)
                    )
            return res

    async def _idle_reaper(self, child: ChildState) -> None:
        """Poll the child's last_activity_at; SIGTERM after idle_shutdown_s.

        Runs as a task per on_demand child. Cancelled when the child stops
        for any other reason.
        """
        spec = child.spec
        # Poll at a fraction of the idle window so we react reasonably fast.
        poll_s = max(spec.idle_shutdown_s / 4.0, 0.1)
        while True:
            try:
                await asyncio.sleep(poll_s)
            except asyncio.CancelledError:
                return
            if child.status not in ("running", "starting"):
                return
            idle_for = time.time() - child.last_activity_at
            if idle_for >= spec.idle_shutdown_s:
                log.info("[supervisor] %s idle %.1fs, shutting down (on_demand)",
                         spec.node_id, idle_for)
                async with self.lock:
                    if child.status in ("running", "starting"):
                        await self._stop_locked(child, graceful=True, timeout=5.0)
                await self._emit("on_demand_idle_shutdown",
                                 node_id=spec.node_id, idle_for=round(idle_for, 1))
                return

    # ---- graceful drain + in-flight tracking (PROTOCOL-LAYER, generic) ----

    def can_accept(self, node_id: str) -> bool:
        """Generic predicate: should the dispatcher route new work to this child?

        Returns False during drain/stop so the caller can refuse cleanly. The
        supervisor doesn't know what 'work' means — that's the caller's job.
        """
        child = self.children.get(node_id)
        if child is None:
            return True
        return child.status in ("running", "starting")

    def begin_work(self, node_id: str) -> bool:
        """Mark one unit of work in-flight. Returns False if not accepting."""
        child = self.children.get(node_id)
        if child is None:
            return False
        if child.status not in ("running", "starting"):
            return False
        child.in_flight += 1
        child.last_activity_at = time.time()
        return True

    def end_work(self, node_id: str) -> None:
        """Decrement in-flight. If draining and counter hits 0, signal done."""
        child = self.children.get(node_id)
        if child is None:
            return
        if child.in_flight > 0:
            child.in_flight -= 1
        child.last_activity_at = time.time()
        if (child.status == "draining"
                and child.in_flight == 0
                and child.drain_done is not None):
            child.drain_done.set()

    async def drain(self, node_id: str, *, timeout: float = 30.0) -> dict:
        """Stop accepting new work, wait for in-flight==0 or timeout, then SIGTERM.

        Generic: the supervisor only flips the child's `status` to "draining"
        and waits on a counter. Whether "work" means an envelope, an HTTP
        request, or anything else is the caller's choice.
        """
        async with self.lock:
            child = self.children.get(node_id)
            if child is None:
                return {"ok": False, "error": "unknown_node"}
            if child.status not in ("running", "starting"):
                return {"ok": False, "error": "not_running",
                        "status": child.status}
            child.status = "draining"
            child.drain_done = asyncio.Event()
            starting_in_flight = child.in_flight
            if child.in_flight == 0:
                child.drain_done.set()
        await self._emit("drain_start", node_id=node_id,
                         in_flight=starting_in_flight, timeout=timeout)
        timed_out = False
        try:
            await asyncio.wait_for(child.drain_done.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            timed_out = True
        async with self.lock:
            # The drain might have raced with a stop or crash; only stop if
            # we're still the one in 'draining' state.
            if child.status == "draining":
                await self._stop_locked(child, graceful=True, timeout=5.0)
        await self._emit("drain_complete", node_id=node_id,
                         timed_out=timed_out, drained=starting_in_flight)
        return {
            "ok": True,
            "timed_out": timed_out,
            "drained_in_flight": starting_in_flight,
            "child": child.to_dict(),
        }

    # ---- metrics (PROTOCOL-LAYER, generic) ----

    def metrics(self) -> dict:
        """Generic per-child + aggregate metrics. Knows nothing about node kind."""
        now = time.time()
        children = []
        total_restarts = 0
        running = draining = failed = on_demand_warm = 0
        for c in self.children.values():
            uptime = (now - c.started_at) if c.status == "running" else 0.0
            total_restarts += c.total_restart_count
            if c.status == "running":
                running += 1
                if c.spec.restart == "on_demand":
                    on_demand_warm += 1
            elif c.status == "draining":
                draining += 1
            elif c.status == "failed":
                failed += 1
            children.append({
                "node_id": c.spec.node_id,
                "status": c.status,
                "pid": c.pid,
                "uptime_seconds": round(uptime, 1),
                "started_at": c.started_at,
                "last_exit_code": c.last_exit_code,
                "last_exit_at": c.last_exit_at,
                "restart_count_total": c.total_restart_count,
                "restart_count_window": c.restart_count,
                "restart_policy": c.spec.restart,
                "in_flight": c.in_flight,
            })
        return {
            "supervisor_started_at": self.started_at,
            "supervisor_uptime_seconds": round(now - self.started_at, 1),
            "totals": {
                "children": len(self.children),
                "running": running,
                "draining": draining,
                "failed": failed,
                "on_demand_warm": on_demand_warm,
                "restarts": total_restarts,
            },
            "children": children,
        }

    async def shutdown_all(self, timeout: float = 5.0) -> None:
        """Stop every supervised child and disable auto-restart on shutdown."""
        self._stopping = True
        async with self.lock:
            for child in list(self.children.values()):
                if child.status in ("running", "starting"):
                    try:
                        await self._stop_locked(child, graceful=True, timeout=timeout)
                    except Exception as e:
                        log.warning("error stopping %s: %s", child.spec.node_id, e)

    # ---- internals (caller holds self.lock) ----

    async def _start_locked(self, spec: ChildSpec) -> dict:
        # Open log file in append mode; supervisor never rotates these
        # (let the host's logrotate do it if needed).
        log_path = pathlib.Path(spec.log_path)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_fd = open(log_path, "ab", buffering=0)
        log_fd.write(f"\n=== supervisor start at {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n".encode())

        # Inherit current env, overlay spec env. Subprocess sees both.
        full_env = dict(os.environ)
        full_env.update(spec.env)

        try:
            proc = await asyncio.create_subprocess_exec(
                *spec.cmd,
                cwd=spec.cwd,
                env=full_env,
                stdout=log_fd,
                stderr=log_fd,
                # Detach from controlling terminal so SIGINT to core doesn't
                # cascade. The supervisor explicitly kills children on shutdown.
                start_new_session=True,
            )
        except FileNotFoundError as e:
            log_fd.close()
            return {"ok": False, "error": "exec_failed", "details": str(e)}
        except Exception as e:
            log_fd.close()
            return {"ok": False, "error": "spawn_failed", "details": str(e)}

        child = self.children.get(spec.node_id)
        if child is None:
            child = ChildState(spec=spec)
            self.children[spec.node_id] = child
        else:
            child.spec = spec  # respec on restart in case env changed

        child.proc = proc
        child.pid = proc.pid
        child.started_at = time.time()
        child.status = "running"
        child.log_fd = log_fd
        child.in_flight = 0
        child.drain_done = None
        child.monitor_task = asyncio.create_task(self._monitor(child))

        await self._emit("spawn", node_id=spec.node_id, pid=proc.pid)
        log.info("[supervisor] spawned %s pid=%d log=%s", spec.node_id, proc.pid, spec.log_path)
        return {"ok": True, "child": child.to_dict()}

    async def _stop_locked(self, child: ChildState, *, graceful: bool, timeout: float) -> dict:
        child.status = "stopping"
        proc = child.proc
        if proc is None or proc.returncode is not None:
            child.status = "stopped"
            return {"ok": True, "child": child.to_dict()}
        # Cancel monitor first so it doesn't try to restart on the deliberate exit.
        if child.monitor_task and not child.monitor_task.done():
            child.monitor_task.cancel()
        # Cancel the idle reaper if this is an on_demand child.
        if child.idle_reaper_task and not child.idle_reaper_task.done():
            child.idle_reaper_task.cancel()
            child.idle_reaper_task = None
        try:
            if graceful:
                # SIGTERM to the whole process group (start_new_session=True
                # made the child a session leader; PGID==PID).
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except (ProcessLookupError, PermissionError):
                    proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=timeout)
                except asyncio.TimeoutError:
                    log.warning("[supervisor] %s ignored SIGTERM, sending SIGKILL", child.spec.node_id)
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except (ProcessLookupError, PermissionError):
                        proc.kill()
                    await proc.wait()
            else:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    proc.kill()
                await proc.wait()
        finally:
            if child.log_fd:
                try:
                    child.log_fd.write(
                        f"=== supervisor stop at {time.strftime('%Y-%m-%d %H:%M:%S')} (rc={proc.returncode}) ===\n".encode()
                    )
                    child.log_fd.close()
                except Exception:
                    pass
                child.log_fd = None
            child.last_exit_code = proc.returncode
            child.last_exit_at = time.time()
            child.status = "stopped"
            child.proc = None
            child.pid = None

        await self._emit("stop", node_id=child.spec.node_id,
                         exit_code=child.last_exit_code)
        return {"ok": True, "child": child.to_dict()}

    async def _monitor(self, child: ChildState) -> None:
        """Wait for the child to exit. On unexpected exit, maybe restart."""
        proc = child.proc
        assert proc is not None
        try:
            rc = await proc.wait()
        except asyncio.CancelledError:
            return  # deliberate stop
        # Reached only on natural exit (crash or clean close)
        child.last_exit_code = rc
        child.last_exit_at = time.time()
        if child.log_fd:
            try:
                child.log_fd.write(
                    f"=== child exited rc={rc} at {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n".encode()
                )
                child.log_fd.close()
            except Exception:
                pass
            child.log_fd = None

        if self._stopping:
            child.status = "stopped"
            return

        # Decide whether to restart.
        spec = child.spec
        normal_exit = (rc == 0)
        if spec.restart == "on_demand":
            # An on_demand child exiting on its own is normal — that's the
            # whole point. Don't auto-restart; wait for the next ensure_running().
            # Cancel the idle reaper since the child is already gone.
            if child.idle_reaper_task and not child.idle_reaper_task.done():
                child.idle_reaper_task.cancel()
                child.idle_reaper_task = None
            child.status = "stopped"
            child.proc = None
            child.pid = None
            await self._emit("on_demand_exit", node_id=spec.node_id, rc=rc)
            return
        if spec.restart == "temporary":
            should_restart = False
        elif spec.restart == "transient":
            should_restart = not normal_exit
        else:  # permanent
            should_restart = True

        if not should_restart:
            child.status = "stopped" if normal_exit else "crashed"
            await self._emit("exit", node_id=spec.node_id, rc=rc, restarted=False)
            return

        # Throttle: count restarts in a sliding window
        now = time.time()
        if (now - child.restart_window_start) > spec.restart_window_s:
            child.restart_window_start = now
            child.restart_count = 0
        child.restart_count += 1
        child.total_restart_count += 1
        if child.restart_count > spec.max_restarts:
            child.status = "failed"
            log.error(
                "[supervisor] %s exceeded restart budget (%d/%ds), giving up",
                spec.node_id, spec.max_restarts, spec.restart_window_s,
            )
            await self._emit("give_up", node_id=spec.node_id,
                             restart_count=child.restart_count)
            return

        # Exponential backoff capped at 30s: 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 30.0...
        backoff_s = _backoff_seconds(child.restart_count)
        log.warning("[supervisor] %s exited rc=%d, restarting in %.1fs (attempt %d/%d)",
                    spec.node_id, rc, backoff_s, child.restart_count, spec.max_restarts)
        await self._emit("restart_scheduled", node_id=spec.node_id,
                         rc=rc, attempt=child.restart_count, backoff_s=backoff_s)
        child.status = "crashed"
        await asyncio.sleep(backoff_s)

        # Re-acquire the lock to actually restart.
        async with self.lock:
            if self._stopping:
                return
            # If something else (admin stop, reconcile-remove) already handled it,
            # don't auto-restart.
            current = self.children.get(spec.node_id)
            if current is not child:
                return
            if current.status in ("stopped", "stopping"):
                return
            await self._start_locked(spec)


# ---------- default runner resolver ----------

def make_script_resolver(repo_root: str, log_dir: str) -> RunnerResolver:
    """Default resolver: read the per-node command from the manifest.

    Resolution order:

    1. ``metadata.runner.cmd`` on the manifest node — the canonical way to
       declare a per-node command. ``cmd`` may be a string (run through
       ``/bin/sh -c``) or a list (exec'd directly).
    2. Legacy fallback: ``scripts/run_<node_id>.sh`` under ``repo_root``,
       used only if a ``scripts/`` directory exists at the repo root.
       This branch is a compatibility shim for the original reference
       layout and is deprecated — new manifests should set
       ``metadata.runner.cmd``.

    Returns ``None`` when neither path resolves (e.g. dummy actors that
    are one-shot envelope senders, not long-running).
    """
    root = pathlib.Path(repo_root).resolve()
    logs = pathlib.Path(log_dir).resolve()
    scripts_dir = root / "scripts"

    def resolve(node_id: str, manifest_node: dict) -> Optional[ChildSpec]:
        meta = manifest_node.get("metadata", {}) if manifest_node else {}
        runner_meta = meta.get("runner", {}) if isinstance(meta, dict) else {}
        if "cmd" in runner_meta:
            cmd = runner_meta["cmd"]
            if isinstance(cmd, str):
                cmd = ["/bin/sh", "-c", cmd]
        elif scripts_dir.is_dir():
            script = scripts_dir / f"run_{node_id}.sh"
            if not script.exists():
                return None
            cmd = ["/bin/bash", str(script)]
        else:
            return None
        env = dict(runner_meta.get("env", {}) or {})
        env["MESH_NODE_ID"] = node_id
        return ChildSpec(
            node_id=node_id,
            cmd=cmd,
            env=env,
            cwd=str(root),
            log_path=str(logs / f"{node_id}.log"),
            restart=runner_meta.get("restart", "permanent"),
            max_restarts=int(runner_meta.get("max_restarts", 5)),
            restart_window_s=float(runner_meta.get("restart_window_s", 60.0)),
            idle_shutdown_s=float(runner_meta.get("idle_shutdown_s", 30.0)),
        )

    return resolve

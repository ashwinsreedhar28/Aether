# mesh_introspection

Mesh node that polls Core's `/__introspection__` admin endpoint at 2s
cadence and exposes the result through two mesh surfaces. First-class
consumer is the mesh-viz shell app (Sprint 5 Lane 1, sub-lane 3 / #108).

## Surfaces

- `mesh_introspection.topology` — latest snapshot of nodes + edges.
  No params. Returns `{ nodes, edges, stale?, fetched_at_ms }`.
- `mesh_introspection.activity` — latest activity ring buffer
  (newest-first). No params. Returns `{ activity, stale?, fetched_at_ms }`.

Both are cache-then-serve: invocations return the most recent
successfully-fetched snapshot. If the cache is older than 10s,
`stale: true` is set so consumers can distinguish fresh from stale.
If no fetch has succeeded yet (broker down at boot), surfaces return
`MeshDeny('broker_unreachable')`.

Auth + broker contract failures map to:
- `broker_unreachable` — connection refused / network error
- `broker_unauthorized` — HTTP 401 (ADMIN_TOKEN mismatch)
- `broker_timeout` — fetch exceeded 1500ms

## State

In-memory cache only. No SQLite. The standard `running` marker file
is written under `$AETHER_DATA_DIR/mesh_introspection/running` after
Core registration.

## Environment

- `MESH_MESH_INTROSPECTION_SECRET` — required. Mesh identity secret,
  injected by the shell at startup.
- `ADMIN_TOKEN` — required. Bearer for the broker's
  `/__introspection__` admin endpoint. Injected by the shell at
  startup (same value Core was started with).
- `MESH_CORE_URL` — defaults to `http://127.0.0.1:8000`.
- `AETHER_DATA_DIR` — required (marker file only).

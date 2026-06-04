# visualizer

Mixer mesh node that bridges the **mesh (data layer)** to the **RAVEN_AVP scene
server (presentation layer)**. It is the only mesh component that knows about
both: it reads mesh state via `node.invoke()` and POSTs composed SceneDoc panels
to the scene server over HTTP. "Mesh in, HTTP out."

## Surface

- `visualizer.render` — request/response. Input `{ intent: string, args?: object }`.
  Returns `{ ok: true, intent, panels }` or `{ ok: false, intent, error }`.
  Internally routed by `intent` to a template function.

### Intents

- `mesh` — **summoned overlay.** Reads `mesh_introspection.topology`, composes a
  single markdown panel (nodes grouped by category + the edge list) and upserts
  it under the stable non-dashboard id `viz-mesh`. A repeat invoke updates it in
  place rather than stacking copies.
- `dashboard` — **always-present backdrop.** Composes the `dashboard.*` panels
  (`dashboard.mesh-health`, `dashboard.raven-status`) and upserts them. Run once
  on boot (seed) and re-POSTed every ~5s (merge endpoint) so the backdrop stays
  live.
- `lanes` — reads `lanes.status` and composes the dev-lane activity panel,
  appearing both as a `dashboard.lanes` backdrop (re-POSTed on the ~5s loop) and
  a `viz-lanes` summoned overlay. Resilient: a down lanes sensor renders a
  "lanes sensor unavailable" panel rather than disappearing.
- `gaps` — **summoned overlay.** Reads `intents.list` (newest ~20) and composes
  a `viz-gaps` panel of the recorded capability gaps — timestamp + gap text,
  count in the header, newest-first. Resilient like `lanes`: an empty log renders
  "No recorded gaps" and a down gap sensor renders "gap sensor unavailable"
  rather than failing the summon.
- Any other intent → `MeshDeny('unknown_intent', { intent })`.

New intents are added by writing a template function and adding a switch case —
the routing is deliberately trivially extensible. Other intents
(sensor-health, agent-queue, …) are Sprint 7+.

## Panels are script-free in v1

All panels are `text`/`markdown` kind — **no html, no inline SVG, no
client-side JavaScript.** The macOS shell renders html panels in an `iframe`
with `sandbox=""` (no scripts) per Sprint 6.3b, so a graphical inline-SVG mesh
visualization would not render. A markdown structured-text representation ships
a working diagnostic surface today; the graphical mesh viz is a deferred
fast-follow for once a sandbox-relaxation policy exists.

### `style` values MUST be strings

The Swift AVP client decodes a panel's `style` as `[String: String]?`; a
non-string value (number, bool, null) silently kills the entire SceneMessage
decode (governance-log 2026-05-26). `scene_client.ts#coerceStyle` is the single
choke point that stringifies every value before POST — it is impossible to ship
a non-string style from this node.

## Scene endpoints

- `POST /scene/panel` — append; 409 if the id already exists.
- `POST /scene/panel/{id}` — merge in place; 404 if the id doesn't exist.

`SceneClient.upsertPanel` tries merge first (so re-POSTs of stable ids never
409), falling back to append on a 404 (first seed). All scene I/O is
failure-tolerant: a down scene server yields `{ ok: false }`, the node logs and
skips the cycle, and the next tick retries — the node never crashes on a scene
outage.

## Environment

- `MESH_VISUALIZER_SECRET` — required. Mesh identity secret, injected by the
  shell at startup. (No `ADMIN_TOKEN` needed: the visualizer reads
  `mesh_introspection`'s **surface** via the mesh, not the broker's admin
  endpoint directly.)
- `AETHER_DATA_DIR` — required (the `running` marker file lives under
  `$AETHER_DATA_DIR/visualizer/running`).
- `MESH_CORE_URL` — defaults to `http://127.0.0.1:8000`.
- `AETHER_SCENE_SERVER_URL` — defaults to `http://127.0.0.1:5180`.

## State

In-memory only; no SQLite. The standard `running` marker is written after Core
registration.

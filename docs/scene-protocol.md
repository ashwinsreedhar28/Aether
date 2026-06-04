# Scene Panel Protocol — Contract v1

> **Audience:** anyone building a client against the RAVEN_AVP scene server —
> the macOS Electron shell (2D, exists today) and the visionOS AVP shell (3D,
> Swift, collaborator, Sprint 17). **Build the renderer against this document,
> not against our source.** Where this doc and the source disagree, the source
> wins and the divergence is a bug in this doc — see
> [Appendix A: Observed discrepancies](#appendix-a-observed-discrepancies) and
> file the correction.
>
> **Status:** descriptive of the server as implemented at the
> `daemons/raven-avp-server` submodule pin on 2026-06-04
> (`server/main.py`, `server/scene_doc.py`). FastAPI app self-identifies as
> `RAVEN_AVP v1.0`; the wire models have since grown to ~v1.7 internally (see
> Appendix A). This document's own contract version is **v1** — see
> [Versioning](#5-versioning).

---

## Overview

The scene server is a single-process **FastAPI** app (`server/main.py`) that
holds **one authoritative `SceneDoc`** — a flat list of `panels` plus a flat
list of `entities` — and exposes it over HTTP + WebSocket on **port 5180**,
bound to `0.0.0.0` (loopback for this machine; Tailscale for the AVP headset).

Three roles meet at this server, and the split is load-bearing (see
`docs/agent-platform-roadmap.md`):

- **Producers** mutate the scene by `POST`/`PUT`/`PATCH`. In Aether today the
  only mesh producer is the **visualizer node** (`nodes/visualizer` — "mesh in,
  HTTP out"); the **shell CLI** also POSTs panels directly (`/post <text>`).
- **The server** holds the authoritative `SceneDoc`, persists it to
  `scene_state.json`, assigns every mutation a monotonic `seq`, and broadcasts a
  delta to all subscribers.
- **Subscribers** open `WS /scene/stream`, receive one snapshot on connect, then
  apply deltas. The macOS shell subscribes from the **main process**
  (`shell/electron/main/services/sceneSubscriber.ts`) and pushes frames to the
  renderer over IPC; the AVP shell subscribes directly. **Subscribers never
  POST through the socket** — the stream is read-only; mutations are separate
  HTTP calls.

Concurrency: a single `asyncio.Lock` guards state + disk + broadcast, so every
mutation is atomic and last-write-wins. There is **no merging of concurrent
writers** beyond field-level partial merges on a single request.

```
 visualizer node ──POST /scene/panel/{id}──┐
 shell CLI       ──POST /scene/panel──────► │   RAVEN_AVP scene server (FastAPI :5180)
                                            │   • authoritative SceneDoc {version,seq,panels,entities}
                                            │   • scene_state.json (atomic write)
                                            │   • seq++ per mutation, then broadcast
                                            └─►├──WS /scene/stream──► macOS shell (2D)
                                               └──WS /scene/stream──► AVP shell (3D, Sprint 17)
```

---

## 1. Endpoints (as implemented)

All routes live in `server/main.py`. Bodies and responses are JSON. Every
**mutating** endpoint returns the **full updated `SceneDoc`** (not just the
touched panel) and broadcasts a `delta` frame to all stream subscribers before
returning. Pydantic validation failures surface as **HTTP 422** with a
`{"detail": "..."}` body unless noted otherwise.

### `GET /scene`

Full-state fetch. No body.

- **200** → the entire `SceneDoc`:

  ```json
  {
    "version": 1,
    "seq": 1,
    "panels": [ /* Panel objects, in list order */ ],
    "entities": [ /* Entity objects, in list order */ ]
  }
  ```

Use this to refetch authoritative state after a reconnect (the WS also sends a
snapshot on connect — see §3; GET is the pull-based alternative).

### `POST /scene/panel` — append a new panel

Body: a **fully-specified `Panel`** (see §2). Appends to the end of the panel
list.

- **200** → full updated `SceneDoc`.
- **409** → a panel with this `id` already exists (`{"detail": "panel '<id>' already exists"}`).
- **422** → body fails `Panel` validation (missing `transform`/`size`, bad
  `kind`/`url`, …).

### `POST /scene/panel/{panel_id}` — merge into an existing panel

Body: a **partial `Panel`** — every field optional; omitted fields keep their
current server value. `id` may be omitted (taken from the URL); if present it
must equal `{panel_id}`.

- **200** → full updated `SceneDoc`. **If the merge produces no change, the
  server returns 200 but does NOT bump `seq` and does NOT broadcast a delta**
  (see §3, "no-op writes").
- **404** → no panel with that id (`{"detail": "panel '<id>' not found"}`).
- **400** → body `id` present and ≠ URL id.
- **422** → partial fails validation.

This is the **idempotent update** path. The visualizer's `upsertPanel` calls
this first and falls back to `POST /scene/panel` on a 404 — so stable backdrop
ids (`dashboard.*`) re-POST in place without 409 storms, and first-seed POSTs
still create the panel.

### `POST /scene/panel/{panel_id}/transform` — gesture-end transform sync

Body: `{position?, rotation?, scale?, size?}` — all optional; omitted fields
keep current values. Merges only spatial fields (the AVP shell's drag/scale
end). Same **200 / 404 / no-op-no-broadcast** semantics as the merge endpoint.
**The 2D shell never calls this** (it ignores transforms); it exists for the 3D
client.

### `DELETE /scene/panel/{panel_id}` — remove a panel

No body.

- **200** → full updated `SceneDoc` (panel gone); broadcasts a `remove` delta.
- **404** → no panel with that id.

### Scene-wide writes (whole-doc)

- **`PUT /scene`** — replace the panel set. Body `{"panels": [...], "entities"?: [...]}`.
  Panels matching an existing `id` are partial-merged; new panel ids must be
  fully specified (else 422); **panels absent from the body are removed**.
  `entities` is optional — omit to leave entities untouched. **422** on missing
  `panels` or a panel missing `id`.
- **`PATCH /scene`** — apply a **JSON Patch** (RFC 6902) op list as the request
  body (`[{op, path, value}, ...]`). **400** on a malformed patch or on any op
  that would set a `transform`/`size` scalar to `null` (use field omission +
  merge semantics instead); **422** if the patched document fails `SceneDoc`
  validation.

### Entities (parallel primitive — out of the panel contract's core, summarized)

Entities are 3D geometry (spheres, cubes, lines, …) the **2D shell does not
render**; the AVP shell does. They ride the **same `SceneDoc` and the same
delta stream** as panels. Endpoints mirror panels exactly:
`POST /scene/entity`, `POST /scene/entity/{id}`, `DELETE /scene/entity/{id}`,
and `PUT /scene/entities` (bulk replace; each entity must be fully specified).
A 2D client should consume the `entities` array and entity-bearing deltas as
**inert pass-through** (the macOS shell's reconcile skips any change whose
`entity` field is populated — see §3).

### `WS /scene/stream` — subscribe

Open the socket; the server **immediately sends one `snapshot` frame** and
thereafter pushes one `delta` frame per mutation. The server does **not** expect
client→server messages on this socket — it reads only to detect disconnect.
Frame shapes are in §3.

### Other routes (not part of the panel contract)

Present on the server but outside this contract: `GET /openai_key` (the AVP app
fetches the session key here), `POST /events` + `GET /events/recent` +
`WS /events/stream` (client→server **gesture** echo for scene-driver agents —
**a different socket from `/scene/stream`**, not consumed by renderers), and
`/scenes`, `POST /scenes/find`, `POST /scenes/run` (named-scene library).
Renderers can ignore all of these.

---

## 2. Panel anatomy

A `Panel` is the unit of rendered content (`server/scene_doc.py:Panel`). Wire
shape:

| Field       | Type                          | Required | Notes |
|-------------|-------------------------------|----------|-------|
| `id`        | string                        | **yes**  | Stable identity. Reconciliation + addressing key. |
| `kind`      | enum (below)                  | no       | Defaults `"text"`. |
| `text`      | string                        | no       | Defaults `""`. The **body** for `text`/`markdown` panels. |
| `url`       | string \| null                | conditional | **Required & validated http(s)** for `html`/`image`/`model3d` kinds; ignored otherwise. |
| `data`      | string \| null                | no       | Free-form payload slot (e.g. inline content); unused by the 2D renderer. |
| `transform` | `{position, rotation, scale}` | **yes**  | Each a 3-float array. `scale` defaults `[1,1,1]`; `position`/`rotation` required. 3D placement — **the 2D shell ignores it**. |
| `size`      | `{width, height}`             | **yes**  | Floats (metres in 3D). **2D shell ignores it.** |
| `style`     | object \| null                | no       | Metadata map. **See the string-only constraint below.** |

There is **no `title` field and no separate `body` field** on the wire. The 2D
shell renders `id` as the card's header chip and `text` as the body; producers
encode any "title" as the first line/heading of `text` (markdown panels use a
`#` heading). Provenance metadata travels in `style` (e.g.
`{"source": "visualizer", "panel": "mesh-health"}`), not in a title.

### `kind` enum

Server accepts (`Panel.kind` `Literal`):
`text` · `html` · `image` · `markdown` · `model3d` · `chart` · `mermaid` · `group`.

**The server validates the enum; it does not guarantee any client renders every
value.** Known renderer coverage:

| kind       | macOS 2D shell (`PanelRenderer.tsx`)         | Producers emitting it today |
|------------|----------------------------------------------|-----------------------------|
| `text`     | ✅ `<pre>`, monospace, wrapped                | shell CLI |
| `markdown` | ✅ react-markdown + GFM                       | visualizer (all panels) |
| `html`     | ✅ `<iframe sandbox="">` — **no scripts**, requires `url` | — |
| others     | ⚠️ fallback "Unsupported panel kind: <kind>" | — |

A 2D client **must** degrade unknown kinds gracefully (the shell shows a muted
fallback line). `html` panels render as a **fully-sandboxed** iframe — no
scripts, no same-origin, no forms — so inline-SVG/JS visualizations will not run
there; this is why the visualizer ships markdown, not SVG.

### Create vs. merge semantics

- **Create** (`POST /scene/panel`): the body is a *complete* panel; missing
  required fields → 422; duplicate `id` → 409. Panel lands at the **end** of the
  list.
- **Merge** (`POST /scene/panel/{id}`): the body is *partial*; present fields
  overwrite, omitted fields are inherited from the current panel; unknown `id` →
  404. Position in the list is **preserved**.
- The convention across producers is **stable ids + merge-or-create** (the
  visualizer's `upsertPanel`): pick a deterministic `id`, try merge, fall back to
  create. Re-posting the same `id` updates in place rather than stacking copies.

### `style` values MUST be strings (cross-client hard constraint)

The Swift AVP client decodes `style` as `[String: String]?`. **A non-string
value (number, bool, null) silently kills the entire frame decode** — the panel
never renders and there is no client-side error (governance-log 2026-05-26). The
Python server's Pydantic model types `style` as a permissive `dict | None` and
does **not** enforce this; the constraint lives at the producer. The visualizer
funnels every panel through `coerceStyle()` (numbers → `"14"`, bools →
`"true"`/`"false"`, null/undefined dropped) before POST. **Any new producer must
do the same** — emit string-valued `style` only.

### Ordering

- The server stores panels as an **ordered list**; `GET /scene` and snapshots
  return them in that order. Appends go to the **end**; merges/updates keep a
  panel's existing slot.
- Within a delta, **panel changes come before entity changes**, and within
  panels, **removes precede adds/updates** (adds/updates follow new-list order).
- The 2D shell renders in **arrival order** by default, but overlays a
  **user-saved arrangement** (drag-to-reorder, persisted shell-side): known ids
  in saved order, then unknown/new ids appended in arrival order. **Render order
  is therefore a client concern — the server does not promise a stable visual
  order, only a stable list order.**

---

## 3. Lifecycle

### Summon → POST → broadcast → render

1. A trigger (voice intent routed to the visualizer, or a CLI `/post`) composes
   one or more `Panel` objects.
2. The producer **POSTs** them (merge-or-create). The server validates, mutates
   the authoritative `SceneDoc` under the lock, **increments `seq`**, persists to
   `scene_state.json`, and **broadcasts a `delta`** to every `/scene/stream`
   subscriber.
3. Each subscriber applies the delta to its in-memory mirror and **re-renders**
   the affected panel(s).

### Frame shapes on `WS /scene/stream`

**Snapshot** (exactly one, on connect):

```json
{ "type": "snapshot", "scene": { "version": 7, "seq": 7, "panels": [ … ], "entities": [ … ] } }
```

**Delta** (one per mutation):

```json
{ "type": "delta", "seq": 8, "version": 8, "changes": [ /* DeltaChange */ ] }
```

A `DeltaChange` (`scene_doc.py:DeltaChange`) carries an `op` and exactly the
payload that op needs:

| `op`     | fields present                | meaning |
|----------|-------------------------------|---------|
| `add`    | `panel` (or `entity`)         | new object; **no `id` field** — read it from `panel.id` |
| `update` | `panel` (or `entity`) **+ `id`** | replace the object with this id |
| `remove` | `id` only                     | drop the object with this id |

**Panel and entity changes share one `changes` array.** A consumer tells them
apart by **which field is populated** (`panel` vs `entity`). A `remove` carries
**only `id`** with neither `panel` nor `entity`, so a 2D client cannot
distinguish a panel-remove from an entity-remove from the delta alone — filter
your panel list by `id` (harmless if the id was an entity's; it matches
nothing), or trust the next snapshot. This is exactly what the macOS shell does
(`SceneView.tsx:reconcile`).

### Refresh / reconnect

- The shell subscriber reconnects with capped backoff (`1s → 2s → 5s → 10s →
  30s`). **On every (re)connect the server re-sends a full snapshot**, so a
  reconnecting client rebuilds state from the snapshot — it does not need to
  replay missed deltas, and the snapshot is authoritative.
- `GET /scene` is available as an explicit pull-based refetch but the macOS
  shell relies on the WS snapshot instead.

### No-op writes produce no delta

A merge / transform POST whose result equals the current panel returns **200
with the unchanged `SceneDoc` but bumps nothing and broadcasts nothing**.
Consumers must not assume "I POSTed, therefore a delta is coming." Idempotent
re-POSTs of an unchanged backdrop are silent on the wire.

### What a consumer may NOT assume

- **No ack / no echo.** The stream is fire-and-forget broadcast. There is no
  per-client acknowledgement and no request-id correlation between your POST and
  the delta you receive.
- **`seq` / `version` are not a gap-free contiguity guarantee you can poll
  against** — they increase by 1 per *broadcast* mutation, but a no-op write
  advances neither. Treat `seq` as a monotonic ordering hint, and the snapshot
  as the source of truth on reconnect. (Today `version` always equals `seq`; do
  not rely on that — see Appendix A.)
- **No reserved ids.** Any producer can overwrite or delete any panel by id.
  Identity is by convention, not enforcement.
- **No per-client filtering.** Every subscriber sees the whole scene; there is
  no subscription scope or query. Render-time filtering is the client's job.
- **Persistence is server-side and last-write-wins.** Panels survive a server
  restart (reloaded from `scene_state.json`); they do **not** survive a producer
  choosing to delete or overwrite them.

---

## 4. Panel payloads in practice

The wire allows any `Panel`, but the panels a renderer actually sees today come
from two producers. These are illustrative real shapes (from
`nodes/visualizer/src/templates.ts` and `shell/src/dashboard/Cli.tsx`):

**Backdrops** — always-present, re-POSTed in place on the visualizer's **~5 s**
dashboard loop via the merge endpoint. Stable `dashboard.*` ids:

- `dashboard.mesh-health` — mesh node roster grouped by category + freshness footer.
- `dashboard.raven-status` — raven/voice status.
- `dashboard.lanes` — dev-lane (git-worktree) activity.

**Summoned overlays** — created/updated on a voice or CLI trigger, stable
non-`dashboard.` ids so a repeat summon updates in place:

- `viz-mesh` — mesh topology (nodes + edge list).
- `viz-lanes` — lanes detail.
- `viz-gaps` — recorded capability gaps (`N open · M closed` header).
- `viz-agenda` — calendar agenda (today + tomorrow).
- `cli-<timestamp>` — ad-hoc text panel from the shell CLI `/post`.

A representative visualizer panel (markdown kind, string-only style):

```json
{
  "id": "dashboard.mesh-health",
  "kind": "markdown",
  "text": "# Mesh Health\n\n**Sensor**\n- calendar · seen 3s ago\n…",
  "transform": { "position": [0, 1.5, -1.3], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
  "size": { "width": 0.5, "height": 0.3 },
  "style": { "source": "visualizer", "panel": "mesh-health" }
}
```

The CLI's text panel (note `id` is timestamp-unique, so it always appends):

```json
{
  "id": "cli-1717513200000",
  "kind": "text",
  "text": "hello world",
  "transform": { "position": [0, 1.5, -1.3], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
  "size": { "width": 0.5, "height": 0.3 },
  "style": { "source": "cli" }
}
```

The `dashboard.` vs non-`dashboard.` id prefix is the **only** wire signal of
"poll-refreshed backdrop" vs "user-summoned overlay" — `style.source` names the
*posting node*, not the *trigger*. The 2D shell uses the prefix to decide
whether a re-POST should fire an attention affordance (backdrops: no; summoned:
yes). A 3D client is free to use the same convention or ignore it.

`transform`/`size` are present on every panel because the server's Pydantic
model **requires** them, even though the 2D shell ignores them. The coordinates
above (`y≈1.5`, `z≈-1.3`, `x` spreads panels apart) are the seed-scene
convention for the 3D shell.

---

## 5. Versioning

This contract is consumed by **two independent renderers** — the 2D macOS shell
(in-tree) and the future 3D AVP shell (the collaborator's Swift tree, built
against this doc). They do not share code, only this contract. Therefore:

- This document is **Scene Panel Contract v1**.
- **Any wire-breaking change** — a renamed/removed field, a changed required-ness,
  a new mandatory field, a changed delta-frame shape, a new `style` typing rule —
  **requires a versioned update to this doc** (bump to v2, note what changed and
  the server pin it reflects) **and** a heads-up to the AVP client owner, since
  they cannot see it via a typecheck.
- **Additive, backward-compatible changes** (a new optional `kind` value, a new
  optional field, a new endpoint) stay within v1 but should still be recorded
  here so both renderers learn about them from one place.
- The server's internal model version (`scene_doc.py` comments reference v1.0
  through v1.7) is **not** this contract's version. This doc tracks the
  *renderer-facing wire contract*, which moves more slowly than the server's
  internal model.

---

## Appendix A: Observed discrepancies

Recorded, **not fixed** (this is a documentation lane). Each is a doc-vs-code or
doc-vs-doc mismatch found while writing this contract.

1. **Backdrop re-POST interval: `~10s` (stale) vs `~5s` (actual).**
   `shell/src/dashboard/SceneView.tsx` (the `isSummonDriven` comment) says the
   visualizer re-POSTs `dashboard.*` backdrops "on the visualizer's ~10s poll
   loop." The actual interval is **5 s** — `nodes/visualizer/src/index.ts`
   `DASHBOARD_INTERVAL_MS = 5_000`, and both `nodes/visualizer/README.md` and
   `templates.ts` correctly say `~5s`. The SceneView comment is the outlier.
   This doc uses **~5 s**.

2. **FastAPI app version string `1.0` vs model version `~1.7`.**
   `server/main.py` declares `FastAPI(title="RAVEN_AVP v1.0", version="1.0")`,
   but `server/scene_doc.py` documents incremental wire additions up to **v1.7**
   (e.g. the `Entity.animation` field, `cluster_id` at v1.3.3). The advertised
   app version has not tracked the model. Consumers should treat the **model
   shapes**, not the app `version` string, as the source of truth.

3. **Brief's "title/body" panel framing has no wire counterpart.**
   The lane brief describes panel anatomy as "title/body." The `Panel` model has
   **no `title` field and no `body` field** — it has `id` (rendered as the 2D
   card header) and `text` (the body). Recorded so a renderer author does not go
   looking for a `title` key. This doc documents the actual fields in §2.

4. **`kind` enum is wider in the server than in any renderer or producer.**
   The server validates **8** kinds (`text, html, image, markdown, model3d,
   chart, mermaid, group`); the 2D shell renders **3** (`text, markdown, html`)
   and falls back on the rest; the visualizer's own TypeScript `PanelKind` type
   narrows to **2** (`text, markdown`). Not a bug — but a renderer built only
   from the visualizer's types would under-estimate what can arrive on the wire.
   Build against the **server enum** and degrade unknowns.

5. **Shell IPC `scene:post-panel` is append-only, not upsert.**
   `shell/electron/main/index.ts` POSTs CLI panels to **`/scene/panel`**
   (append) unconditionally — it does not mirror the visualizer's
   merge-then-create `upsertPanel`. This is safe **only** because the CLI mints
   timestamp-unique `cli-<ts>` ids that never collide; a future shell producer
   reusing a stable id through this IPC path would 409. Noted as a latent sharp
   edge, not a present bug.

6. **`DECISIONS.md` describes reconnect refetch as `GET /scene`; the shell uses
   the WS snapshot.** `DECISIONS.md` (Sprint 6.3 entry) says "HTTP GET `/scene`
   for full-state refetch on reconnect." The shell subscriber actually relies on
   the **automatic WS snapshot** the server sends on every accept, and does not
   call `GET /scene` on reconnect. Both mechanisms exist and agree; only the
   *which-one-the-shell-uses* detail differs from the ADR's phrasing.

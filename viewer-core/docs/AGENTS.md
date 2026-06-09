# Driving the viewers — agent guide

You (an agent) control two viewer shells through **one** contract:

- **`viewer-desktop`** (macOS / Electron) — renders a View inside an OS window.
- **`viewer-spatial`** (visionOS) — renders the *same* View as a floating HTML panel on the headset.

Everything you touch is exported from `@viewer/core` (`src/index.ts`) or is a
documented endpoint on the spatial server / desktop mesh node. **Do not invent
APIs.** If it is not in this doc, it does not exist.

---

## 1. Mental model: one View, two shells, two authoring paths

A **View** is a platform-agnostic description of *what* is shown — never *how*.
Same View → 2D React renderer in a desktop window, or an HTML panel on Vision Pro.

There are **two first-class ways** to put Views on screen, both unified by the
View contract. Keep both; neither is deprecated.

| Path | Verb | You write… | Best for |
| --- | --- | --- | --- |
| **Generators** (declarative) | EMIT | a pure `params -> View[]` function | building a whole structured artifact in one shot (a graph, a dashboard, a multi-panel layout) — full model control |
| **Tools** (imperative) | PLACE | calls to mesh surfaces, one View at a time | quick edits: open one file, close/focus/raise a view, incremental scene changes |

Both produce/consume the identical `View`. A generator's emitted `View[]` flows
through the **same** open path the tools use. The knowledge-graph generator is
the proof: one generator → one `knowledge-graph` View → renders 2D on desktop,
HTML panel on spatial.

---

## 2. The View object

```ts
import type { View } from '@viewer/core';

interface View {
  id: string;                 // stable; addresses the view across open/close/focus
  type: ViewType;             // discriminator → which renderer draws it (10 types)
  title?: string;             // tab label (desktop) / panel caption (spatial)
  source: { kind: 'inline' | 'path' | 'url'; value: string; mediaType?: string };
  layout?: { w?: number; h?: number; hint?: 'default'|'wide'|'tall'|'compact'|'focus' };
  meta?: Record<string, unknown>;   // opaque; hosts/renderers may read, contract ignores
}
```

**The 10 ViewTypes** (`VIEW_TYPES`, exported) and when each applies:

| type | use for | natural file ext |
| --- | --- | --- |
| `markdown` | prose, docs, notes (editable on desktop) | `md`, `markdown` |
| `text` | plain text / logs (editable on desktop) | `txt`, `log` |
| `json` | structured data, config (editable on desktop) | `json` |
| `mermaid` | diagrams from mermaid source | `mmd`, `mermaid` |
| `kanban` | board of columns/cards | `kanban` |
| `knowledge-graph` | node+edge mindmap (the generator proof case) | `mindmap` |
| `image` | raster/vector image | `png`,`jpg`,`gif`,`webp`,`svg`,… |
| `html` | rendered HTML | `html`, `htm` |
| `latex` | math / LaTeX | `tex`, `latex` |
| `table` | CSV / tabular data | `csv`, `tsv` |

**The 3 source kinds** — resolution is the *host's* job, never the renderer's:

| kind | `value` is… | desktop | spatial |
| --- | --- | --- | --- |
| `inline` | the content itself | written to a temp file, hosted | served as the panel's content |
| `path` | a filesystem path | read via Electron `fs` | read via the Python bridge |
| `url` | an `http(s)` URL | **unsupported — rejected** (see §7) | fetched by the panel's WKWebView |

**Validate before you ship a View.** `validateView(value)` → `{ ok, errors }`;
`assertView(value)` → returns the View or throws with every error. The mesh
layer and both shells validate with these exact rules (the Python side mirrors
them in `viewer_core.assert_view`), so a View accepted by one is accepted by all.

```ts
import { assertView } from '@viewer/core';
const view = assertView({ id: 'readme', type: 'markdown',
  source: { kind: 'path', value: '/Users/me/README.md' } });
```

---

## 3. Tools path (imperative — mesh surfaces)

Both shells expose the **same six** Lattice surfaces
(`mesh/viewer-surfaces.json`). Call them identically regardless of target.

> **Direction.** Every surface in this section (and `run_generator` in §4) is
> **outbound: agent → view**. They are surfaces the *viewer node* exposes and
> you call. There is exactly **one inbound surface, `view_event` (view → agent)**
> — and **your agent**, not the viewer node, exposes it. The shells emit to you.
> See §4.

| Surface | Type / mode | Payload | Returns |
| --- | --- | --- | --- |
| `open_view` | tool / request_response | a **View** | `{ ok, id }` |
| `close_view` | tool / request_response | `{ "id": string }` | `{ ok }` |
| `focus_view` | tool / request_response | `{ "id": string }` | `{ ok }` |
| `list_views` | tool / request_response | `{}` | `{ views: View[], focused?: id }` |
| `list_generators` | tool / request_response | `{}` | `{ ok, generators: [{ slug, describe, paramsSchema? }] }` |
| `notify` | inbox / fire_and_forget | `{ "level"?: "info"\|"warn"\|"error", "text": string }` | 202 ack, **no body** |

- The five control surfaces are **request_response**: you need the result to
  proceed (`open_view` returns the `id` to address the view later; `list_views`
  is the reflection surface you read *before* acting; `list_generators` is the
  discovery surface you read *before* `run_generator` — it tells you which
  generators exist, see §5). Core blocks until the node answers or `504`s.
- `notify` is **fire_and_forget**: a one-way nudge to the human (desktop toast /
  spatial caption). Nothing to await; do not depend on it.

`open_view`'s payload **is** a View — there is no wrapper object.

### Worked example (tools): open a markdown file, list, focus, close

```jsonc
// open_view  (payload IS a View)
{ "id": "design-doc", "type": "markdown",
  "source": { "kind": "path", "value": "/Users/me/design.md" },
  "title": "Design", "layout": { "hint": "wide" } }
// → { "ok": true, "id": "design-doc" }

// list_views   payload: {}
// → { "views": [ {id:"design-doc",...} ], "focused": "design-doc" }

// focus_view   { "id": "design-doc" }   → { "ok": true }
// close_view   { "id": "design-doc" }   → { "ok": true }

// notify   { "level": "info", "text": "design doc opened" }   → 202, no body
```

---

## 4. Receiving interaction (`view_event`) — the one inbound surface

Everything above is a screen you *paint*. `view_event` is the screen *touching
you back*. When the human drags a kanban card, moves a graph node, or toggles a
checkbox in a live view, that gesture is delivered to your agent as a mesh
invocation. This is the only view → agent channel, and it is **yours to expose**.

### Who exposes it (read carefully — this is the #1 confusion)

`view_event` is **not** a surface on the viewer node. It is a
**`fire_and_forget` inbox that YOUR agent declares in its own manifest.** The
viewer shell is the *sender*: at `open_view` time it records who opened the view
(`openedBy` = your `env.from`), and on each interaction it emits a fresh
invocation to `{ to: <you>, surface: 'view_event' }`.

This is the standard mesh reply pattern: the original `open_view` 202-acked long
ago; a human interaction minutes later is a new, asynchronous event, so it
arrives as a *new* invocation to your inbox — never as a late response on the old
request.

Declare it in your manifest exactly like this:

```json
{
  "name": "view_event",
  "type": "inbox",
  "invocation_mode": "fire_and_forget",
  "schema": "./view_event.payload.json"
}
```

The canonical payload schema lives in viewer-core at
`mesh/view_event.payload.json` — the shared contract both shells emit and your
agent receives. (It is *not* in `viewer-surfaces.json`, because that file lists
surfaces the **viewer node** exposes; `view_event` is exposed by you.)

### The payload (frozen contract)

```jsonc
{
  "viewId": "string",   // the View.id the human interacted with
  "type":   "string",   // the View.type (kanban, knowledge-graph, table, …)
  "action": "string",   // what the human did — enum below
  "data":   { },        // action-specific detail; permissive (extra keys allowed)
  "ts":     "string"    // ISO8601 emit time (shell clock)
}
```

**`action` enum (v1):**

| action | fires when | `data` carries |
| --- | --- | --- |
| `card_moved` | kanban card dragged between columns | `{ cardId, fromColumn, toColumn, position }` |
| `card_edited` | kanban card text changed | `{ cardId, field, value }` |
| `node_moved` | knowledge-graph node dragged | `{ nodeId, x, y }` |
| `checkbox_toggled` | a checklist/markdown checkbox toggled | `{ itemId, checked }` |
| `cell_edited` | table cell edited | `{ row, column, value }` |

`data` is intentionally permissive — an unknown/extra field never breaks the
contract, and the shell will still deliver an action your agent doesn't
recognize. Decide per-action what to do; ignore what you don't handle.

### Worked example: human drags a card, agent reacts

You opened a sprint board: `open_view { id: 'sprint', type: 'kanban', … }`. The
shell recorded `openedBy = you`. The human drags **"Wire view_event"** from
*In Progress* to *Done*. Your inbox receives:

```jsonc
// surface: view_event   (fire_and_forget — nothing to return)
{
  "viewId": "sprint",
  "type": "kanban",
  "action": "card_moved",
  "data": { "cardId": "t-42", "fromColumn": "In Progress", "toColumn": "Done", "position": 0 },
  "ts": "2026-06-06T11:04:22.118Z"
}
```

Your handler reacts however you like — the loop is now closed:

```ts
function onViewEvent(e) {
  if (e.action === 'card_moved' && e.data.toColumn === 'Done') {
    // persist it, then nudge the human back through the OUTBOUND surface:
    notify({ level: 'info', text: `Marked "${e.data.cardId}" done — nice.` });
  }
}
```

Inbound `view_event` in, outbound `notify`/`open_view` out: the human and the
agent now both touch the same screen.

### Where it's live

- **Desktop** (`viewer-desktop`): fully wired. `openedBy` is captured at open
  time and kanban card drags emit `card_moved` to your inbox. This is the
  end-to-end-true shell.
- **Spatial** (`viewer-spatial`): the server-side emit path is the new half;
  visionOS gesture plumbing may be partial. Treat the **loop as identical** but
  check `viewer-spatial` for exactly which gestures are live before you claim a
  spatial interaction round-trips. Don't assume parity with desktop.

---

## 5. Generators path (declarative — `params -> View[]`)

A generator is a **pure function**, not a framework: no DSL, no sandbox, no
codegen — just a function and a registry mirroring the renderer registry.

```ts
// The exported types
type Generator<P = Record<string, unknown>> = (params: P) => View[];
interface GeneratorEntry<P = any> {
  slug: string;            // mesh-reachable name
  describe: string;        // one line: what it emits
  paramsSchema?: object;   // advisory only
  generate: Generator<P>;
}
```

`runGenerator(genOrEntry, params)` is the safety boundary: it calls the
generator and `assertView`s **every** emitted View, throwing
`generator emitted invalid View at index N: …` rather than leaking a malformed
payload into a shell.

### Authoring + registering (TS)

```ts
import { registerGenerator, runGenerator, type View } from '@viewer/core';

const dashboard = {
  slug: 'dashboard',
  describe: 'Emit a markdown header + a json metrics panel.',
  generate: (p: { title: string; metrics: object }): View[] => [
    { id: 'dash-head', type: 'markdown',
      source: { kind: 'inline', value: `# ${p.title}` } },
    { id: 'dash-metrics', type: 'json',
      source: { kind: 'inline', value: JSON.stringify(p.metrics) },
      layout: { hint: 'wide' } },
  ],
};
registerGenerator(dashboard);

const views = runGenerator(dashboard, { title: 'Ops', metrics: { qps: 12 } });
// → View[] (validated). On desktop: open each via the open_view surface.
```

### The same shape in Python (spatial server-side)

The spatial server runs generators server-side from the Python mirror
(`viewer_generators`), output byte-identical to the TS one:

```python
# viewer-core/python/generators/<slug>.py  (mirror of the TS file)
from viewer_core import assert_view  # validation parity

def dashboard_build(params: dict | None = None) -> list[dict]:
    p = params or {}
    return [
        {"id": "dash-head", "type": "markdown",
         "source": {"kind": "inline", "value": f"# {p.get('title','')}"}},
        {"id": "dash-metrics", "type": "json",
         "source": {"kind": "inline", "value": __import__("json").dumps(p.get("metrics", {}))},
         "layout": {"hint": "wide"}},
    ]

dashboard_generator = {"slug": "dashboard",
    "describe": "Emit a markdown header + a json metrics panel.",
    "generate": dashboard_build}
# register_generator(dashboard_generator)   # so /generators/{slug}/run can find it
```

### Discovering what to run (`list_generators` / `GET /generators`)

You don't have to know a slug in advance. Both shells expose a discovery surface
that reflects the registry so you can **see which generators exist before you run
one**. Each entry is exactly `{ slug, describe, paramsSchema? }` — the addressable
name, a one-line description, and the advisory params schema. The `generate`
function is **never** returned; this is metadata only.

- **Desktop:** the `list_generators` mesh surface (request_response, empty `{}`
  payload). Read it before `run_generator`.
  ```
  list_generators {}
  → { "ok": true, "generators": [ { "slug": "knowledge-graph",
        "describe": "Emit a knowledge-graph View …", "paramsSchema": {…} }, … ] }
  ```
- **Spatial:** `GET /generators` — the HTTP equivalent, identical item shape.
  ```
  GET http://100.109.10.50:5180/generators
  → { "generators": [ { "slug": "knowledge-graph", "describe": "…",
        "paramsSchema": null }, … ] }
  ```

The return item shape is symmetric across shells: `{ slug, describe,
paramsSchema }`. Pick a slug, then call `run_generator` / `POST
/generators/{slug}/run` below.

### Running a generator on each shell

- **Spatial:** `POST /generators/{slug}/run` with the params object as the JSON
  body. The server looks up the slug in the Python registry, `run_generator`s it
  (validates every View), and opens **each** emitted View as an HTML panel — a
  whole artifact appears from one call, no per-element requests.
  ```
  POST http://100.109.10.50:5180/generators/knowledge-graph/run
  Body: { "name": "My Graph" }      (or {} / null for the demo graph)
  → { "slug": "...", "opened": [ {view_id, panel_id, url}, ... ], "scene": {...} }
  ```
- **Desktop:** `run_generator` mesh surface (request_response). Send
  `{ "slug": "...", "params": {...} }`; the node resolves the slug in the shared
  `@viewer/core` registry, runs it to a `View[]` (validating each), then opens
  every emitted View through the same `open_view` seam.
  ```
  run_generator { "slug": "knowledge-graph", "params": { "name": "My Graph" } }
  → { "ok": true, "slug": "...", "opened": [view_id, ...], "count": N }
  ```
  This is the mesh symmetry of spatial's HTTP route above — **one call opens the
  whole artifact on either shell.** (You can still `runGenerator(...)` in-process
  and loop `open_view` yourself; `run_generator` just does that loop over the mesh.)

> **Don't confuse this with the spatial `/scenes/run` path.** The spatial
> server has a SECOND, separate registry — `/scenes/run` — that emits native
> 3D entities/Groups (spheres, lines, models), not Views. That path is for
> content that IS spatial; the `/generators/{slug}/run` path above is for
> portable Views that must look identical on desktop. They share *data*, never
> *renderers*: `extract_wiki_graph()` feeds BOTH the 3D scene (`knowledge_graph`)
> and the 2D View (`wiki_graph_2d`). See `viewer-spatial/server/AGENTS.md` §1.

### Worked example: the knowledge-graph generator (the proof case)

```ts
import { buildKnowledgeGraph, knowledgeGraphGenerator,
         registerKnowledgeGraphGenerator, runGenerator } from '@viewer/core';

registerKnowledgeGraphGenerator();               // slug 'knowledge-graph'
const [kgView] = buildKnowledgeGraph();           // demo graph, no params
// or with data:
runGenerator(knowledgeGraphGenerator, {
  name: 'My Graph',
  nodes: [{ id: 'a', title: 'A', position: { x: 40, y: 40 }, color: '#4a9eff' }],
  edges: [],
});                                               // → one knowledge-graph View
```
Spatial equivalent: `POST /generators/knowledge-graph/run` with the same params.

---

## 6. Choosing a path

> **Are you building one structured artifact from data? → generator.
> Are you placing/poking individual views? → tools.**

| Task | Path |
| --- | --- |
| "Open this README" | tool — `open_view` once |
| "Build a knowledge graph of these 12 nodes" | generator — emit one `knowledge-graph` View |
| "Bring the design doc to the front" | tool — `focus_view` |
| "Lay out a 4-panel ops dashboard from metrics" | generator — emit 4 Views |
| "What's currently open?" | tool — `list_views` |
| "Tell the user the build finished" | tool — `notify` |

---

## 7. Desktop vs spatial — differences you MUST know

- **`url` sources:** spatial fetches them in the panel's WKWebView; **desktop
  rejects them** (`MeshDeny viewer_url_source_unsupported`). Use `inline` or
  `path` if the View must open on desktop.
- **Interaction round-trip differs by shell:** gestures are no longer discarded —
  they flow back to your agent as `view_event` (§4). On **desktop** this is fully
  wired: a kanban card drag emits `card_moved` to your inbox, and `markdown`/
  `text`/`json` editors also write back locally. On **spatial** the server-side
  emit path is the new half and visionOS gesture plumbing may be partial — the
  panel is still hosted as HTML, so before you rely on a spatial gesture
  round-tripping, check `viewer-spatial` for which actions are live. Don't assume
  spatial parity with desktop.
- **Spatial panel-hosting model:** `open_view` on spatial registers the View
  (`POST /views/open`), then mounts an `html` entity whose `url` points at the
  static viewer bundle (`/static/viewer/index.html?view=<id>`). The headset's
  WKWebView fetches `GET /views/<id>`, looks up the renderer by `view.type`, and
  mounts the SAME renderer the desktop uses.
- **`RAVEN_AVP_PUBLIC_HOST` reachability:** the panel URL is loaded *on the
  headset*, so it must be a device-reachable host (default the Tailscale address
  `100.109.10.50:5180`), **never** `127.0.0.1`. Override via the env var for
  other networks. If panels load blank, suspect this first.
- **`layout.w/h` units:** desktop = px (`≥1`) or screen-fraction (`<1`); spatial
  = meters (clamped to `0.10–2.0`).

### CRITICAL spatial gotcha — a bad field silently blanks the WHOLE scene

When you author scene entities/panels on spatial (not Views — the lower-level
SceneDoc), two rules are unforgiving:

1. **Every panel `style` value must be a STRING.** `{"background": "#101014"}`
   is valid; `{"opacity": 0.5}` (a number) blanks the entire scene on the
   client. Stringify everything.
2. **Entity animation uses key `type` (never `kind`), value ∈
   `{rotate_y, rotate_axis, pulse_y}`.** A missing/unknown `type` (or using
   `kind`) silently blanks the scene.
   - `rotate_y` → `rate` (rad/s) · `rotate_axis` → `axis [x,y,z]` + `rate` ·
     `pulse_y` → `amplitude` (m) + `period` (s).

There is no error — the scene just goes empty. When a spatial scene blanks after
an edit, check these two first. (Views opened via `open_view`/generators avoid
this: the server builds the panel for you with string styles.)

---

## 8. Where generator code lives (the convention)

**Canonical (TypeScript, shared):**
`@viewer/core/src/generators/<slug>.ts`. Export your `GeneratorEntry` (and any
helpers) from `src/generators/index.ts`, which re-exports through `src/index.ts`.
Register at startup with `registerGenerator(entry)`. This is the single source
of truth; the desktop shell imports and runs it in-process.

**Python mirror (for spatial server-side `/generators/{slug}/run`):**
`viewer-core/python/generators/<slug>.py`, kept byte-identical in output to the
TS file (fixed JSON key order + compact separators — see the kg generator).
Register it in the Python registry with `register_generator(entry)` so
`get_generator(slug)` resolves it. **The spatial server runs from a *vendored
copy*** of the Python mirror at `viewer-spatial/server/viewer_generators.py`
(currently byte-identical, copied manually — there is no sync script). A new
Python generator is not reachable on the headset until that copy is updated and
the generator is registered at import time.

Slug = the stable, mesh-reachable name. Use the same slug in TS and Python so
`open_view`-of-emitted-Views (desktop) and `POST /generators/{slug}/run`
(spatial) address the identical artifact.

> Note: `/generators/{slug}/run` uses the `viewer_generators` registry. It is
> distinct from the spatial *scenes* system (`/scenes`, `/scenes/{slug}/run`),
> which is a separate SceneDoc-level preset registry — do not conflate them.

---

## 9. Common mistakes

- **Wrapping the View for `open_view`.** The payload *is* the View. No
  `{ "view": {...} }` envelope.
- **Hand-rolling the generator loop.** Desktop has a `run_generator` mesh surface
  — send `{slug, params}` and it runs + opens every View for you (spatial
  equivalent: `POST /generators/{slug}/run`). Looping `open_view` yourself still
  works but isn't required. There is no desktop *HTTP* `/generators/run` route —
  that shape is spatial-only.
- **Reusing a live view id in `open_view`.** Denied (`viewer_id_in_use`) — it
  won't silently replace the window (that would orphan the old one). `close_view`
  the id first, or pick a fresh id. After a context reset, `list_views` to see
  what's already open.
- **`url` source on desktop.** Rejected. Use `inline`/`path`.
- **Awaiting `notify`.** It's fire-and-forget; there is no body to read.
- **Empty `source.value`.** Fails validation (`source.value must be non-empty`).
- **Unknown `type` / `layout.hint`.** Must be one of the enumerated values;
  validation lists the legal set in the error.
- **Numeric `style` values / wrong animation key on spatial.** Blanks the scene
  silently (§7).
- **Expecting the viewer node to expose `view_event`.** It doesn't. `view_event`
  is an **inbox YOUR agent declares** (§4); the shells emit *to you* (`to =`
  the `env.from` they captured at `open_view`). If you never declare the inbox,
  the gestures have nowhere to land.
- **Replying to a `view_event` on the open_view request.** It's a *new*
  fire_and_forget invocation, not a late response — there is nothing to return.
  React with a fresh outbound call (`notify`, re-`open_view`, persist).
- **Assuming spatial gestures round-trip like desktop's.** Desktop is fully
  wired; spatial's gesture-emit half may be partial — check `viewer-spatial`.
- **Adding a Python generator and expecting the headset to see it.** Vendor the
  copy into `viewer-spatial/server/` and register it at import time.

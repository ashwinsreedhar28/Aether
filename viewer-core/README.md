# @viewer/core

The shared keystone of the viewer ecosystem. One contract, two shells.

`viewer-desktop` (macOS / Electron) and `viewer-spatial` (visionOS / RealityKit)
serve different purposes but show the *same content* and answer to the *same
agents*. This package defines that overlap exactly once:

- **The View contract** (`schema/view.ts`) — a platform-agnostic description of
  *what* is shown (typed content + where its data lives + a layout hint). It says
  nothing about *how* it is shown. The desktop renders a View inside a window; the
  spatial shell renders the same View as a floating HTML panel.
- **Runtime validation** (`schema/validate.ts`) — dependency-free `validateView` /
  `assertView`. The mesh layer and both shells validate `open_view` payloads with
  identical rules.
- **The renderer registry** (`renderers/registry.ts`) — the contract every shared
  content renderer implements (a pure `(view, data) => ReactNode`) and the lookup
  both shells use. Resolution of `View.source` into bytes is the *host's* job, which
  is what lets the exact same renderer mount in a desktop window OR a spatial panel.

## Cross-language parity

The contract is mirrored for the Python side of the spatial bridge:

- `schema/view.schema.json` — JSON Schema (draft-07) form.
- `python/viewer_core.py` — hand-rolled `validate_view` / `assert_view` kept in
  lockstep with `schema/validate.ts`.

A View accepted by the TS validator is accepted by the Python validator, and vice
versa — so an agent's `open_view` is honored identically regardless of which shell
receives it.

## For agents

Driving the viewers (any agent: RAVEN, a cell, a teammate) goes through this
package's one View contract — two shells, two authoring paths (generators emit
Views, tools place them).

- **[docs/AGENTS.md](docs/AGENTS.md)** — the canonical guide: the View object +
  10 types, the 5 mesh tool surfaces with payloads, how to write/register/run a
  generator (TS + Python), choosing tools-vs-generators, desktop↔spatial
  differences, and the spatial scene-blanking gotchas.
- **[docs/system-prompt.md](docs/system-prompt.md)** — a tight, copy-pasteable
  system-prompt fragment to drop into an agent's context so it drives viewers
  correctly (pick a type, pick a path, write a valid View, call the right
  surface, avoid the spatial gotcha).

## View shape

```ts
interface View {
  id: string;                 // stable, addresses the view across open/close/focus
  type: ViewType;             // markdown | text | json | mermaid | kanban |
                              // knowledge-graph | image | html | latex | table
  title?: string;
  source: { kind: 'inline' | 'path' | 'url'; value: string; mediaType?: string };
  layout?: { w?: number; h?: number; hint?: 'default'|'wide'|'tall'|'compact'|'focus' };
  meta?: Record<string, unknown>;
}
```

## Develop

```bash
npm install
npm run build      # tsc → dist/ (types + js)
npm run test       # vitest — validates the keystone
npm run typecheck
```

## Design rules

- Keep it small. Every field added here is a field three places must honor
  (desktop, spatial Node host, Python bridge).
- Renderers are PURE. No fs, no fetch, no Electron, no window assumptions.
- Converge the **content** and **control** layers only. The shells stay distinct
  (desktop owns windows/terminal/files; spatial owns 3D/gestures/scenes).

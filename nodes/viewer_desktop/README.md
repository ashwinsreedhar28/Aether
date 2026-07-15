# viewer_desktop — the agent→renderer control node

The agent→renderer control node, hosted inside the shell main process —
this directory holds only its surface schemas; there is no standalone
process. The implementation lives at
`shell/electron/main/services/viewerNode.ts`. Translates mesh invocations
into renderer control actions (`executeViewerControl` →
`window.__viewerControl`) so an agent — raven, the self-build loop, another
node — can open/close/focus apps and content views in the Viewer surface.
Outbound `view_event` (human interaction) flows back to the opening agent
via fire-and-forget.

- Category: **Actor** · runtime: `local-process` (in-process with the shell)
- Surfaces: `open_app` · `list_apps` · `open_view` · `list_views` ·
  `list_windows` · `focus_window` · `close_window` · `apply_layout` ·
  `place_window` · `notify` · `show_lane_card`
- Params and return shapes per surface: the JSON Schemas in
  [`schemas/`](schemas/) are the contract — each schema's `description`
  documents both.

This prose was displaced from `manifest.yaml`'s `metadata.description`
when the 280-char schema cap was enforced (#384).

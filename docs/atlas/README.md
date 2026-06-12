# The Atlas — Aether's visual architecture map

This directory holds Aether's **visual documentation**: one living map of the
whole running system, plus a frozen gallery of point-in-time snapshots.

## The living map

- **[architecture.html](architecture.html)** — the complete architecture layout:
  process topology, the signed mesh (nodes, categories, edges), the voice
  pipeline, the data layer, the cockpit views, the self-building loop, and a
  ports/processes quick-reference. **It is kept current.** Every count in it
  states where it was read from in the source (a manifest parse, a config line,
  a boot path), so it can be re-verified rather than trusted. Disagreements
  between a doc and the code are recorded in its Appendix A, not silently
  smoothed over in prose (the [scene-protocol](../scene-protocol.md) precedent).

Open it in a browser — it is a single self-contained file (fonts from Google
Fonts, no other dependencies, no build step).

## History — frozen snapshots

`history/` holds dated, point-in-time visual docs. **They are never updated.**
Their statistics are deliberately frozen at the moment they were drawn — a node
count or a tool count in a snapshot is a fact about *that day*, not a claim
about today. They diverge from each other on purpose (e.g. "37 voice functions"
vs "20 voice tools" count different units on different days); the living map
above reconciles them.

| Snapshot | What it captured |
|---|---|
| [history/2026-06-03-sprint-review.html](history/2026-06-03-sprint-review.html) | Substrate review — cockpit day, the gap loop opens, the branched (Core / AVP) roadmap |
| [history/2026-06-04-progress-ledger.html](history/2026-06-04-progress-ledger.html) | Two-day progress ledger — the cockpit, then the loop that builds the rest |
| [history/2026-06-04-rag-mcp-sketch.html](history/2026-06-04-rag-mcp-sketch.html) | "No MCP today" — where a RAG MCP server slots into the mesh |
| [history/2026-06-11-v0.11.0-cut.html](history/2026-06-11-v0.11.0-cut.html) | The v0.11.0 cut — the Viewer merge landed, gaps file as GitHub issues, lanes spawn by voice; the flip-book's first cut-time snapshot |
| [history/2026-06-11-v0.12.0-cut.html](history/2026-06-11-v0.12.0-cut.html) | The v0.12.0 cut — the loop closed end to end: gate reports on the issue thread, voice proceed, the reviewer cell keyed to head SHA, voice closeout, the composer's maiden flight, and the fragments contract |
| [history/2026-06-12-v0.13.0-cut.html](history/2026-06-12-v0.13.0-cut.html) | The v0.13.0 cut — the house takes requests: the music vertical end to end by the pipeline (node · voice + face · library + touch), the apps-interactive/panels-display-only split, and READY TO TEST — the gate announces itself |

## The convention

> **Visual docs land here.** The living map (`architecture.html`) is updated in
> place as the system changes. At each release cut, the current living map is
> **re-snapshotted into `history/`** under a dated filename and that copy is
> frozen — building, over time, a flip-book of how the architecture evolved.

So the split is: one file that always describes *now*, and a growing shelf of
files that each describe a *then*.

# research

Mesh **Mixer** node: searches the Semantic Scholar Graph API for academic
papers and synthesizes a multi-paper research brief with Claude. The first
Aether node that calls an LLM directly — Sensors (news_feeds, finance, …)
only *read*; this node *synthesizes*. The node-as-LLM-caller pattern (key
sourcing, model config, failure→`MeshDeny`) is recorded in
[`decisions/2026-06-17-research-mixer-anthropic-caller.md`](../../decisions/2026-06-17-research-mixer-anthropic-caller.md).

Source lifted (geography only) from Pulse `src/main/services/researchService.ts`:
the Semantic Scholar search + influence ranking and the one-call Claude
synthesis. The citation-lineage panel (cited-by / references / foundational /
bridge papers) is deliberately out of scope this lane — the Phase-3 piece.

## Surfaces

`research.search` — `request_response` — [`schemas/search.json`](schemas/search.json).
Keyword search, **no LLM**. `{ query }` → `{ query, papers: ResearchPaper[] }`.

`research.brief` — `request_response` — [`schemas/brief.json`](schemas/brief.json).
Search + ONE Claude synthesis. `{ query }` → a full `ResearchBrief`
(`{ query, sections, papers, generatedAt }`), persisted to SQLite for recall.

`research.recent` — `request_response` — [`schemas/recent.json`](schemas/recent.json).
Recall stored briefs, newest first. `{ limit? }` → `{ briefs: ResearchBrief[] }`.

### Shapes

```ts
ResearchPaper  = { paperId, title, abstract|null, year|null, authors[],
                   venue|null, citationCount, influentialCitationCount,
                   url, pdfUrl|null }
ResearchBriefSection = { heading, body, citations: paperId[] }   // citations index into papers
ResearchBrief  = { query, sections: ResearchBriefSection[], papers: ResearchPaper[], generatedAt }
```

## Denials (clean reasons, never a half-rendered brief)

- `research_bad_query` — empty / non-string / > 300-char query.
- `research_search_failed` — Semantic Scholar rate-limited or unreachable (`code: rate_limited | upstream`).
- `research_no_papers` — search returned nothing for the query.
- `research_synthesis_failed` — Claude call failed, no usable JSON, or no key
  (`code: no_api_key | no_papers | failed`).

## Configuration

- **`ANTHROPIC_API_KEY`** (required for `research.brief`) — sourced from the
  environment (the Anthropic SDK default), flowed in via the shell's spawn +
  the repo-root `.env.local`. Unset, the node boots degraded: `research.search`
  still works; `research.brief` denies `research_synthesis_failed` by name.
- **`AETHER_RESEARCH_MODEL`** (optional) — overrides the house default model
  (`claude-opus-4-8`). Model choice is config, not a code edit.
- **`AETHER_DATA_DIR`** (required) — writable root; the node persists
  `research/research.db` (briefs) and a `research/running` liveness marker.
- **`MESH_RESEARCH_SECRET`**, **`MESH_CORE_URL`** — mesh identity + Core URL,
  injected by the shell on spawn.

## Notes

The `research.brief` call must finish inside the mesh's 30s invoke budget
(`core invoke_timeout_s`): the S2 fetch is capped at 12s and the Claude call
is a single non-streaming request with a small `max_tokens`. Briefs are
read-back whole from SQLite (`sections`/`papers` stored as JSON), so recall
never re-calls Claude — and the brief store feeds the living-brain corpus
later.

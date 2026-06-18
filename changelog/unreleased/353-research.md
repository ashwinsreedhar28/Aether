### Added
- Research vertical, end-to-end — Aether's first **Mixer** node, the one that
  calls an LLM (#353). A new `research` node (`nodes/research`, category
  `Mixer`) searches the Semantic Scholar Graph API (no key, influence-ranked)
  and synthesizes a multi-paper, cited brief with Claude in ONE call, over
  three surfaces: `research.search` (papers only, no LLM), `research.brief`
  (search + synthesis, persisted to local SQLite), and `research.recent`
  (recall stored briefs without re-calling Claude). The brief contract is
  `{ query, sections: [{ heading, body, citations }], papers, generatedAt }`
  where citations index into the paper list. Empty/bad query, a Semantic
  Scholar failure, a missing key, or a synthesis failure each return a clean
  `MeshDeny` — never a half-rendered brief. Voice: `research_brief` ("research
  X" / "what does the literature say on Y") and `research_recent` ("what did I
  find on X") route through the mesh, and `'research'` joins the `open_app`
  hint set with a prompts.json note ("open the research app" → `open_app` id
  `research`). Surface: a Research MeshApp (`shell/src/apps/research`, auto-
  discovered like every other app) with a query box, a sectioned brief whose
  inline citation chips jump to the matching paper card, paper cards
  (authors, year, venue, abstract, Open/PDF links into the in-app browser),
  and a recent-briefs recall strip. Manifest registers the node + three
  surfaces and the `raven`/`shell → research.{search,brief,recent}` edges.
  Key sourcing is `ANTHROPIC_API_KEY` from the environment (degraded without
  it — search works, brief denies by name) and the model is config
  (`AETHER_RESEARCH_MODEL`, default `claude-opus-4-8`); the node-as-LLM-caller
  pattern is recorded in an ADR. The Phase-3 citation-lineage panel is
  deferred. Closes #353.

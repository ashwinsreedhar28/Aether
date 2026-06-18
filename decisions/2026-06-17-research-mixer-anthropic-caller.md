## [2026-06-17] ADR: the research Mixer is the first node to call an LLM directly — key from env, model is config, failure is a MeshDeny (#353)

**Status:** accepted

**Decided by:** Architect (spec on #353), shape choices by Implementer on
`lane/issue-353`.

**Context:** Every Aether mesh node to date is a **Sensor** (news_feeds,
finance, weather, clipboard_history, …) or a fan-out composer that only reads
other nodes (digest, category `Mixer`, calls `news_feeds`/`finance`/`weather`
and assembles prose deterministically — no model). #353 lifts Pulse's research
service: Semantic Scholar search plus a Claude multi-paper synthesis. That
makes the `research` node the first one that *calls an LLM directly* — it does
not just read the mesh, it asks a model to write. Two questions had no
precedent in-tree: where the model API key comes from for a TypeScript node,
and how a model/network failure is surfaced. The only existing LLM caller, the
Rung-1.5 composer (`daemons/architect-draft/compose_spec.py`, ADR
2026-06-11-rung-1-5-…), is an out-of-mesh Python PAT actor with a deliberate
*no-default-model* rule tied to its self-certification guard — a governance
concern that does not apply to a synthesis Mixer.

**Decision:** Three bindings for node-as-LLM-caller, recorded so future Mixers
can cite them rather than re-derive:

1. **Key from the environment.** The node reads `ANTHROPIC_API_KEY` via the
   official `@anthropic-ai/sdk` default, flowed in by the shell's existing
   `...process.env` spawn merge (`nodeManager.spawnNode`) plus the repo-root
   `.env.local` (`env-loader`). No new secret-passing channel — same path
   `SPOTIFY_CLIENT_ID` (music) and `AETHER_GITHUB_TOKEN` (github) already ride.
   Unset, the node boots **degraded**: `research.search` still works;
   `research.brief` denies by name. The key is the real gate.
2. **Model is config, with a safe default.** `AETHER_RESEARCH_MODEL` overrides
   the model; absent, the node uses the house default `claude-opus-4-8`.
   Unlike the composer, this node SHIPS a default so the vertical works the
   moment the key is set — the model is a quality knob, not a governance
   surface. Per CLAUDE.md the default tracks the latest capable Claude model;
   changing it is config, never a code edit.
3. **Failure is a clean `MeshDeny`, never a half-rendered brief.** S2 rate-
   limit / unreachable → `research_search_failed` (with `code`); empty results
   → `research_no_papers`; missing key / model failure / unparseable output →
   `research_synthesis_failed` (with `code: no_api_key | no_papers | failed`).
   The brief surface returns either a complete brief or a deny — partial
   synthesis is never returned. The whole `research.brief` path is bounded to
   fit the 30s mesh invoke budget (`core invoke_timeout_s`): S2 fetch capped
   at 12s, one non-streaming Claude call with a small `max_tokens`, and
   Pulse's 5s/15s 429 retry backoff dropped (it would blow the budget).

**Consequences:**
- "Mixer that calls a model" is now a named, reusable shape: env key + config
  model + failure-as-MeshDeny + invoke-budget discipline. A future Mixer
  (e.g. a summarizer over mail/messages) follows this without a new ADR unless
  it changes one of the three bindings.
- The node carries a model API dependency (`@anthropic-ai/sdk`) — the first in
  `nodes/*`. It is pure JS (no native build, unlike `better-sqlite3`), so it
  needs no `pnpm-workspace.onlyBuiltDependencies` entry and CI's `pnpm -r build`
  picks it up by auto-discovery.
- The brief surface is the slowest in the mesh by design (a real LLM round-
  trip). Consumers must tolerate multi-second latency: the app shows a
  synthesizing state, the voice tool tells Gemini to acknowledge the pause.
  Anything needing a sub-second answer must not sit behind `research.brief`.
- Two model-config knobs now exist with different rules — the composer's
  `AETHER_DRAFT_MODEL` (no default, governance) and this node's
  `AETHER_RESEARCH_MODEL` (default, quality). The split is intentional and
  documented here so it does not read as inconsistency.

**Alternatives considered:**
- *No default model, mirroring the composer (#312).* Rejected: the composer's
  no-default rule guards self-certification of unratified specs — a Mixer has
  no such guard, and forcing the Director to configure a model before the
  vertical works at all (on top of the unavoidable API key) is friction with
  no safety payoff. The key already gates the capability.
- *Route the model call through the mesh (a shared "llm" node).* Rejected as
  premature abstraction (CLAUDE.md §15, rule of three): research is the first
  and only model caller. When a second arrives, extracting a shared LLM
  surface is a deliberate lane with its own ADR — not a speculative one built
  from a single example.
- *Persist the API key in the macOS Keychain now (the three-tier auth
  pattern).* Rejected for this lane: the key is a single-user, single-process
  env secret like every other node credential today; the per-launch-secrets →
  Keychain migration (MASTER_SYNTHESIS.md §7 Q6) is a separate, mesh-wide move,
  not a research-specific one.
- *Structured outputs (`output_config.format`) to guarantee parseable JSON.*
  Rejected this pass: the brief shape (array of sections each with a citation
  array) hits json-schema's array-constraint limits, adds first-request
  schema-compile latency against the 30s budget, and the lifted Pulse path
  (prompt-for-JSON + tolerant brace-extraction parse) is proven. Reconsider if
  parse failures show up in practice.

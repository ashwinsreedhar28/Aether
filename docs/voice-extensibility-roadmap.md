# Voice extensibility arc roadmap

## Context

Aether's voice substrate today (post-v0.5.0) exposes ~13 tools to
Gemini Live — time, memory, notify, news (recent + search), finance
(quote + market summary + history), digest (compose + last) — with a
fourteenth and fifteenth landing as the weather node fans into voice.
Each tool is a hand-written Python wrapper in
`daemons/raven-core/raven_core/tools/`: a `get_tools()` declaration, a
`handle_call` / `handle_call_async` dispatcher, an entry in
`_TOOL_MODULES`, and (for stateful tools) a per-tool session-context
updater in `tools/__init__.py`. The aggregator
`get_all_tool_declarations()` walks the module list and concatenates
every `types.Tool` into the single `function_declarations` payload
attached to Gemini Live's `LiveConnectConfig` at session start.

This works at 13 tools. It scales linearly with friction — every new
tool is four files touched, a wrapper hand-written, and a new entry
added to a single flat namespace that Gemini sees as one long list of
names. Five tensions surface:

1. **No discoverability.** Director can't ask "what can you do?" and
   get a structured answer. The tool set is implicit in the system
   prompt and in Gemini's training; there is no `tools.list()`.
2. **No user-level composition.** "When I say 'startup routine,' run
   morning briefing, then check calendar, then notify me when done"
   is not expressible. The only composition path is to ask Gemini to
   call tools in sequence in a single turn, which depends on Gemini's
   compliance and is forgotten the moment the session ends.
3. **Hand-written wrapper duplication.** Mesh surfaces already carry
   typed schemas (the news node, finance node, digest node all
   declare their inputs/outputs). The voice-tool wrapper re-declares
   the same shape in `types.Tool` form. Every mesh surface that wants
   to be voice-callable pays this tax.
4. **No modal context.** The system prompt is a single static string.
   Morning Director ("what's on my plate today") and focus-mode
   Director ("don't interrupt me unless it's an alert I subscribed
   to") want different defaults — different tool emphasis, different
   verbosity, different proactivity. Today there is one mode.
5. **No primitives for richer composition.** Sequential and parallel
   tool invocation, conditional branches, retry-on-failure — these
   are general-purpose orchestration shapes that should live below
   Gemini's prompt-engineered compliance, not above it.

This roadmap captures the design for the voice-extensibility arc as
five pieces, each individually shippable and each compounding with
the prior. The arc is sequential within itself (each piece depends
materially on the prior) but composes cleanly with the voice ambient
arc (PR #30) and the MCP integration arc (PR #31) — those modify
*how* the user signals attention and *what* data Aether can reach;
this arc modifies the substrate Gemini Live sees once it's listening.

## The five pieces

### Piece 1: Tool registry + taxonomy

Replace the flat `_TOOL_MODULES` list with a registry that carries a
`category` and a one-line `description` per tool. Categories form the
spoken taxonomy — Gemini and Director can both reason about "data
tools" vs "system tools" without enumerating names.

Initial categories (ordered semantically — see CLAUDE.md §11.1, with
gaps reserved per §11.6):

| Category    | Examples today                          |
|-------------|-----------------------------------------|
| `time`      | `time_now`                              |
| `memory`    | `remember_note`, `recall_note`          |
| `data`      | `news_recent`, `finance_quote`, weather |
| `system`    | `notify`                                |
| `composer`  | `digest_compose`, `digest_last`         |
| `creative`  | (reserved — future image / writing tools) |
| `automation`| (Piece 2 lands the first entries)       |

New voice-callable tools introduced by this piece:

- `tools.list(category?: string)` — return the structured catalogue
  Gemini (or Director, via Gemini) can read. Lists names, categories,
  one-line descriptions.
- `tools.help(name: string)` — return the longer description, args,
  example invocations for a single tool.

The registry is in-process Python state, declared at module load.
No persistence — the source of truth is the code. Each tool module
declares its category in a module-level constant (`CATEGORY = "data"`)
that the aggregator reads alongside `get_tools()`.

PR shape: `feat/voice-tool-registry` — ~1 PR.

This is the foundation. Pieces 2-5 all assume tools carry category +
description metadata that the registry exposes. Lands first.

### Piece 2: User automations / named sequences

Director-named pipelines, voice-created. The motivating shape:

> "Aether, when I say 'startup routine,' run morning briefing, then
> check calendar, then notify me when done."

Tools:

- `automations.create(name, description, sequence)` — persist a named
  pipeline. `sequence` is an array of tool-invocation specs.
- `automations.run(name)` — execute the persisted sequence.
- `automations.list()` — enumerate Director's named automations.
- `automations.delete(name)` — remove one.

Persistence: SQLite (consistent with news_feeds, finance, memory),
single table:

```sql
CREATE TABLE automations (
  name           TEXT PRIMARY KEY,
  description    TEXT NOT NULL,
  sequence_json  TEXT NOT NULL,        -- serialised sequence spec
  created_at     INTEGER NOT NULL,     -- unix ms
  last_used_at   INTEGER               -- unix ms, nullable
);
```

`sequence_json` is the same shape Piece 5's composer accepts (see
below) restricted to v1's sequential-only form: a JSON array of tool
invocations, each `{ "tool": "<name>", "args": { ... } }`. Parallel
fan-out is a Piece 5 addition; automations created in v1 are
sequential-only, and v2's binding choice for conditional steps will
naturally extend `sequence_json` without breaking existing rows.

When `automations.run` fires, the sequence executes inside raven-core
using the same dispatch path Gemini's direct tool calls use. The
result is summarised back to Gemini as the function response so
Director hears a single "done" rather than a play-by-play.

PR shape: `feat/voice-automations` — ~1-2 PRs (one for the SQLite
substrate + the four tools, possibly a second for sequence execution
semantics if those turn out to need their own design pass).

### Piece 3: Mesh-surface auto-mapping

Mesh node schemas already declare their typed surfaces. Today's
wrappers re-declare the same shape as a `types.Tool`. Piece 3
eliminates the duplication: mesh schemas gain an optional
`voice_tool` metadata block, and raven-core auto-generates the
`function_declarations` entry plus an invoke wrapper that translates
Gemini's call into a mesh invocation.

Schema-side shape (sketched, per-node specifics resolved at PR time):

```yaml
# in a mesh node's surface schema
surfaces:
  news.recent:
    input:  { ... }
    output: { ... }
    voice_tool:
      name:        news_recent
      category:    data
      description: "Fetch latest headlines, optionally filtered by category."
      # Gemini-facing arg renaming, defaults, etc. live here
```

raven-core, on startup, walks the mesh surface manifest, collects
every surface with a `voice_tool` block, and generates the
`types.Tool` declaration + the dispatch wrapper that `mesh_invoke`s
the surface. A new voice-callable surface is now zero Python files —
just schema metadata.

Hand-written wrappers remain valid for tools that aren't
mesh-surfaces (`time_tool`, `memory_tool`, the Piece 2 `automations.*`
tools, the Piece 1 `tools.list` / `tools.help` tools — all stay
hand-written because they're not borrowed from mesh nodes).

Recommendation: ship this with at least one existing hand-written
wrapper migrated as the proof case (likely the news or finance
wrapper, whichever has the simplest arg surface). The migration
exercises the auto-mapper end-to-end and proves the displacement is
real.

PR shape: `feat/voice-mesh-automap` — ~1-2 PRs (one for the
schema-driven generator, possibly a second for the first migration
if it surfaces shape-mismatch edge cases).

### Piece 4: Adaptive modes / system-prompt contexts

Today the system prompt is a single static string. Piece 4 introduces
four modes, each with its own system_instruction text:

| Mode      | Activation                       | Character                              |
|-----------|----------------------------------|----------------------------------------|
| `default` | Always available                 | Today's behavior                       |
| `morning` | Time-triggered (05:00 – 10:00)   | Briefing-forward, agenda-aware         |
| `focus`   | User-toggled                     | Minimal interruption, terse responses  |
| `evening` | Time-triggered (20:00 – 24:00)   | Wind-down, reflective, lower energy    |

Tools:

- `modes.current()` — return the currently active mode.
- `modes.set(name)` — switch to a named mode. Triggers a session
  restart so the new system_instruction takes effect.
- `modes.list()` — enumerate available modes.

The key constraint: Gemini Live's `system_instruction` is set once at
session start and cannot be hot-swapped (CLAUDE.md §10). Mode
transitions therefore happen **between** Gemini Live sessions — when
`modes.set` is invoked, raven-core closes the current session and
opens a new one with the new mode's system_instruction. The user
experience is a brief pause (a sentence's worth) when modes change,
not a mid-sentence swap. Time-triggered transitions piggy-back on the
voice ambient arc's idle-detection / re-wake cycle (see "Composition
with other arcs" below) — when the session was already going to
restart, the mode switch is free.

Mode text lives in `daemons/raven-core/raven_core/prompts/modes/`
(one file per mode), versioned with the code. User-tunable mode
threshold (e.g. "morning starts at 6 not 5") is out of scope for v1
— needs a Settings app.

PR shape: `feat/voice-modes` — ~1 PR.

### Piece 5: Composition primitives

A `composer` tool type — a tool whose body is a pipeline of other
tool calls. Pieces 2 and 5 are siblings: Piece 2 lets Director define
named pipelines via voice; Piece 5 generalises the pipeline shape so
the same primitive backs `automations.run`, `digest_compose`, and
future composition needs.

v1 expressiveness — **sequential + parallel only.** Conditional steps
and retry-on-failure are deferred to v2 (binding — see "NOT in
scope").

Pipeline shape: an array where each entry is either

- a single tool invocation `{ "tool": "<name>", "args": { ... } }`,
  executed in sequence with prior steps, OR
- an inner array `[step, step, step]`, executed in parallel and
  joined before the next sequential step.

Worked example (the Piece 2 motivating pipeline, expressed in this
shape):

```json
[
  { "tool": "digest_compose",   "args": { "kind": "morning" } },
  [
    { "tool": "calendar_today", "args": {} },
    { "tool": "news_recent",    "args": { "category": "tech" } }
  ],
  { "tool": "notify",           "args": { "message": "Routine done, sir." } }
]
```

Three sequential top-level steps; the middle step fans out to two
parallel mesh-invocations. The composer joins both before invoking
`notify`.

Tools:

- `compose.run(pipeline)` — execute an ad-hoc pipeline expressed
  inline. Gemini constructs the JSON, the composer runs it.
- `compose.create(name, pipeline)` — persist a pipeline as an
  automation (delegates to Piece 2's `automations.create` under the
  hood; the two tool surfaces converge here).

Argument passing between steps in v1 is by-reference-to-prior-output
via a fixed slot convention (`"$prev"` or `"$steps[N].field"` — exact
shape resolved at PR time). Arbitrary value-transforms between steps
are a v2 concern; v1 keeps the threading shape narrow on purpose.

Failure semantics in v1: any step error halts the pipeline and
surfaces back to Gemini as the failure message. Retry / continue-on-
error is deferred to v2 alongside conditional branches.

PR shape: `feat/voice-composition` — ~1-2 PRs, the most complex
piece. Likely warrants an ADR documenting the pipeline JSON shape
(it becomes a persisted schema once Piece 2's automations row format
binds to it) and the by-reference-to-prior-output convention.

## Dependency ordering

```
Piece 1 (tool registry + taxonomy) - foundation
        ↓
Piece 2 (automations) ──┐
Piece 3 (mesh auto-map) ─┴── parallel to each other; both depend on Piece 1
        ↓
Piece 4 (adaptive modes) - depends on Pieces 1-3 stabilising
        ↓
Piece 5 (composition primitives) - generalises Piece 2's pipeline shape
```

Recommended ship sequence: 1 → (2 and 3 in parallel) → 4 → 5.

Reasoning: Piece 1 is load-bearing for everything after — categories
and descriptions are how every later piece refers to tools.
Pieces 2 and 3 are independent of each other (one persists named
sequences, the other auto-generates wrappers) and can land in either
order. Piece 4's mode-aware tool emphasis benefits from Piece 1's
categories being stable; ships next. Piece 5 generalises Piece 2's
sequence shape into a first-class primitive, so it lands last
(otherwise Piece 2's `sequence_json` format would be rewritten by
Piece 5 within a release).

## Composition with other arcs

The voice-extensibility arc is **substrate-level** — it modifies how
Gemini Live sees the tool set, not how the user signals attention or
what authenticated data Aether can reach.

- **Voice ambient arc (PR #30 / `docs/voice-ambient-roadmap.md`):**
  Composes cleanly. The ambient arc's idle-detection + session-
  restart cycle (Piece 4 of that arc) is the natural seam where this
  arc's mode transitions land for free — when the session was
  already going to restart on next wake-word, the new mode's
  system_instruction is installed at no additional cost. The ambient
  arc's `_session_context` FunctionResponse augmentation (PR #25,
  documented as CLAUDE.md §10's set-once workaround) is unchanged by
  this arc; both arcs feed Gemini context, but on different channels
  (system_instruction at session start vs. FunctionResponse per
  turn).
- **MCP integration arc (PR #31 / `docs/mcp-integration-arc-roadmap.md`):**
  Composes by direct extension. Piece 3 (mesh-surface auto-mapping)
  applies to mesh surfaces; MCP-backed tools come from MCP servers
  with their own declarations and are surfaced through the MCP
  client substrate (that arc's Piece 1). Both arcs feed
  `function_declarations` at session start — voice-extensibility from
  the local registry, MCP from the connected servers — and Gemini
  sees the union. MCP auto-tooling (analogous to Piece 3 but for
  MCP servers' declarations) is explicitly out of scope here and is
  noted as a future-arc candidate.
- **Vision arc (PR #23 / `docs/vision-roadmap.md`):** Orthogonal.
  Vision events route through raven-core's action map; once they
  fire a tool call, they pass through the same dispatch surface this
  arc modifies. No special composition required.

## Future-arc candidates (reserve space per §11.6)

Categories named in Piece 1's taxonomy (`creative`, `automation`)
deliberately reserve space for tools that don't exist yet. Beyond
those, the arc anticipates:

- **MCP auto-tooling** — Piece 3's mesh-surface generator extended to
  MCP server declarations. A natural follow-up once both this arc
  and the MCP integration arc land.
- **Voice-created tools** (Director defines a new tool by speaking
  its name, description, and body) — qualitatively different from
  Piece 2's automations because the body is arbitrary code, not a
  pipeline of existing tools. Out of scope for v1; the registry
  shape (Piece 1) admits it without breaking changes.
- **Tool versioning** — once enough tools accumulate that a behavior
  change in `news_recent` needs to coexist with the old shape.
- **Cross-user / cloud sync** of automations and modes — depends on
  the eventual multi-user story (currently single-user; CLAUDE.md
  §10 voice-ambient's "NOT in scope").
- **Per-tool permission gates** — distinct from the mesh edge graph
  because the principal is Director-via-Gemini, not a mesh node.
  Becomes load-bearing when the tool set includes anything Director
  might want to authorise per-invocation (e.g. shell-out tools,
  payment tools).

## Privacy posture

This arc does not change the privacy posture established by the
voice ambient and MCP arcs. Tool declarations, mode text, and
automation sequences live locally in raven-core (or in SQLite for
automations). Tool *invocations* continue to flow through Gemini
Live exactly as today — the surface this arc adds is metadata about
tools, not new data channels.

One sharpening worth noting: the `automations` table stores Director-
named pipelines that may encode personal routines ("morning
briefing," "evening wind-down"). That table is on-disk under raven-
core's data directory, same posture as the memory tool's notes
today. No new privacy boundary; same contract.

## NOT in scope for this arc

- **Voice-created tools** (defining new tool *bodies* by voice, not
  just composing existing ones). Different problem — code execution
  rather than pipeline composition. Deferred.
- **Tool versioning.** Single-version tools for v1; versioning lands
  when divergence pressure exists.
- **Cross-user / cloud sync** of automations, modes, or registry
  state. Single-user Aether for v1.
- **MCP auto-tooling** (analogous to Piece 3 for MCP server
  declarations). Composes cleanly with the MCP integration arc but
  is its own scope; deferred.
- **Per-tool permission gates** (Director-authorising specific tool
  invocations). Becomes load-bearing later; not v1.
- **Conditional composition primitives** (`if`, `unless`,
  retry-on-failure, continue-on-error). Binding deferral: v1 ships
  sequential + parallel only. Conditional shape is a v2 concern
  because the right place to bind the condition language (Python
  expressions? a constrained DSL? Gemini-mediated branching?) is
  non-obvious and the wrong choice would harden the wrong shape into
  `sequence_json`.
- **User-tunable thresholds** (mode time windows, automation
  defaults). Needs a Settings app, which doesn't exist yet.
- **Tool deprecation / removal flows.** Premature; tool count is
  still small enough to remove by deleting code.

## Open questions for implementation time

To surface during the relevant PR's spec, not now:

1. **Category boundaries (Piece 1):** is `digest_compose` a
   `composer` or a `data` tool? The taxonomy table above puts it in
   `composer`, but Gemini may reason about it more naturally as
   `data` (it returns content). Worth a few rounds with real
   transcripts before binding.
2. **Sequence argument threading (Pieces 2 + 5):** `"$prev"` (refers
   to immediately-prior step), `"$steps[N]"` (refers to step N by
   index), or a named-step convention (`{ "as": "calendar", ... }`
   referenced as `"$calendar"`)? Index-based is simplest; named-step
   is more readable for long sequences.
3. **Mesh-surface auto-mapping arg shape (Piece 3):** does the
   `voice_tool` block override every aspect of the surface's
   declared input schema, or only Gemini-facing labels? The simpler
   answer is "Gemini sees the surface's schema verbatim, just with a
   different display name" — but some surfaces will want to expose a
   subset of fields to voice or rename them for spoken-language
   ergonomics.
4. **Mode transition UX (Piece 4):** explicit "switching to focus
   mode" verbal acknowledgement before the session restart, or
   silent transition (Director hears the new mode's first response
   and infers)? Verbal is more polite but adds latency.
5. **Composition failure semantics (Piece 5):** v1 halts on any step
   error. Some pipelines (e.g. "fetch from N data sources, summarise
   what came back") would prefer continue-on-error. The right answer
   may be a per-pipeline `on_error: "halt" | "continue"` field, but
   that flirts with the conditional-primitives line — defer until v2
   unless usage pressure surfaces it.
6. **Persistence of `tools.list` output across sessions:** does
   Gemini get a fresh registry walk each session, or is the
   declaration cached? The registry is in-process state so the cost
   is negligible, but the answer determines whether `tools.list` can
   be called by Gemini reliably as the very first turn.

These don't block the roadmap doc. They're flagged here so future
implementation PRs surface them.

## [2026-06-11] ADR: Rung 1.5 — machine drafts never self-certify; the composer is an out-of-mesh PAT actor; the draft model is config (#312)

**Status:** accepted

**Decided by:** Architect (spec on #312), shape choices by Implementer on `lane/issue-312`.

**Context:** The corpus and RAG existed; nothing composed. Spec drafting
lived only in the Architect chat, so the failure-driven pattern (gap →
proposal) had no machine path. Rung 1.5 ("offline-model composition",
banked when rung 1 landed) adds the skeleton: gap issue in, draft spec
comment out. The dangerous edge is the spawn guard — `work_on_issue`
certifies an issue as a contract when any line opens with the all-caps
ratification marker, and a machine draft that satisfied it would
self-certify a lane onto unratified content.

**Decision:** Three bindings.

1. **Machine drafts never self-certify.** The composer
   (`daemons/architect-draft/compose_spec.py`) posts under the literal
   comment-opening prefix `DRAFT SPEC (machine-composed, unratified) — `,
   blockquote-defangs any model-emitted line that would anchor the
   line-anchored guard (the gap.ts idiom: content preserved, anchor
   broken), and hard-refuses to post a body that still matches
   (`GuardViolation`). The guard regex is a parity copy of
   `work_on_issue_tool._SPEC_MARKER_RE`, pinned by a test
   (`test_draft_spec_gate.py`) so drift is a test failure, not an
   incident. Ratification is exclusively a human re-posting agreed
   content under the real marker.
2. **The composer is an out-of-mesh actor on the PAT REST contract.** It
   reads the issue and writes the comment with `AETHER_GITHUB_TOKEN` /
   `AETHER_GITHUB_REPO` directly (the #256 PAT-in-env pre-decision), not
   through the github node — it must run standalone (terminal, no mesh,
   no shell), like the reviewer cell on the CI side. The raven voice tool
   `draft_spec(number)` (confirm-gated, two-turn, side-effect contract)
   is only a trigger: it subprocess-runs the composer in its own venv and
   relays the one JSON result line.
3. **The draft model is config, never code.** Resolution: env
   `AETHER_DRAFT_MODEL` → `<data-root>/architect/config.json`
   `draft_model` → instructive refusal. No default model id exists in the
   repo; an unconfigured composer refuses with the knob's name.

**Consequences:**
- A gap issue can carry a machine draft and still read as spec-less to
  every guard consumer; "work on issue N" warns no-spec until the
  Director ratifies — the smoke for the whole rung.
- The guard regex now lives in two files (spawn side, composer side) and
  may only change in lockstep; the parity test is the enforcement.
- The composer needs one-time setup (venv + model config) documented in
  its README; the voice tool's missing-venv refusal names the commands.
- Drafting against an already-ratified issue is refused outright — the
  machine never appends candidate specs below a standing contract.

**Alternatives considered:**
- *Route the comment through the mesh (`raven → github.comment_issue`,
  an existing edge).* Rejected: the composer must run with the mesh down
  (the smoke is a bare CLI run), and splitting compose-here/post-there
  would put the guard's hard floor on the wrong side of a process
  boundary. The voice path still gets its gate — in the tool, before the
  subprocess.
- *Default the model to the house Gemini id when unconfigured.* Rejected:
  "model choice is config, never hardcoded" loses its teeth the moment a
  silent fallback exists; a strong-model choice is a cost/quality call
  that belongs to the Director.
- *Strip or rewrite guard-matching lines instead of blockquoting.*
  Rejected: deletion hides what the model tried to do; the blockquote
  keeps the reviewer's evidence while breaking the anchor.
- *Have raven call the model + RAG in-process.* Rejected: fastembed and
  the composer's deps don't belong in raven-core's venv, and a 1–2 minute
  in-process call would wedge the voice loop; a killable subprocess with
  a timeout fails clean.

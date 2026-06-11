### Added
- Rung 1.5 skeleton — machine-composed draft specs from gap issues (#312): a new
  `daemons/architect-draft/compose_spec.py` takes a gap issue number, fetches the
  record (GitHub REST, the #256 PAT-in-env contract), retrieves precedent from the
  local aether-rag corpus (importing `rag_lib`, the same primitive `search_corpus`
  wraps), prompts the **Director-configured** draft model (env `AETHER_DRAFT_MODEL`
  → `<data-root>/architect/config.json` `draft_model`; no default in code —
  unconfigured is an instructive refusal), and posts the result as an issue comment
  prefixed `DRAFT SPEC (machine-composed, unratified) — `. The load-bearing guard
  interaction: the composer blockquote-defangs any line that would anchor the
  line-anchored spec guard and hard-refuses to post a body that still matches, so a
  machine draft can never self-certify past `work_on_issue`'s spawn gate —
  ratification stays a human re-posting the real marker. Unit tests pin the
  sanitizer, the assembled comment, and guard-regex parity with
  `work_on_issue_tool._SPEC_MARKER_RE`. A new confirm-gated raven voice tool
  `draft_spec(number)` ("draft a spec for issue 311") runs the composer in its own
  venv as a subprocess and relays the comment URL as a tiny side-effect signal.

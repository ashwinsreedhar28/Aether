## [2026-06-09] ADR: trunk-branch-only merge gate — CI + auto-review cover `integration/*`, fork PRs skipped by design

**Status:** Accepted.

**Decided by:** Director (lane spec, Lane 6 of the 2026-06-09 Viewer × Aether merge ADR), implemented by Implementer.

**Context:** The 2026-06-09 Viewer × Aether merge ADR (§9) recorded CI fork-blindness — the auto-review action cannot obtain an OIDC token on fork-originated PRs (`ACTIONS_ID_TOKEN_REQUEST_URL` unavailable) and 401s before running, which is how PR #204 shipped unreviewed — and left an "or": fix the workflow for forks, or route external-contributor work through trunk-repo branches. Separately, the reconciliation lanes target `integration/viewer`, but `ci.yml` triggered only on PRs/pushes to `main`, so Lanes 1–5 merged into the integration trunk with no build/lint/typecheck gate at all.

**Decision:** Resolve the "or" as trunk-branch-only enforcement. (a) `ci.yml` and `claude-auto-review.yml` trigger on PRs targeting `main` *and* `integration/**`; `ci.yml` also runs on pushes to both, so a merged PR re-validates the trunk it landed on. (b) `claude-auto-review.yml` gains `if: github.event.pull_request.head.repo.full_name == github.repository` — fork-originated PRs skip auto-review explicitly rather than failing with a 401; external collaborators (Colton is one) push branches to the trunk repo instead. The PR gate per merge-ADR §8 is build, lint, strict typecheck (`strict` + `noUncheckedIndexedAccess`, enforced by the existing `pnpm -r typecheck` against unloosened tsconfigs).

**Consequences:**
- PRs into `integration/*` now clear the same mechanical bar as PRs into `main`; an integration trunk can no longer silently accumulate non-building commits.
- Fork PRs get neither auto-review nor (by policy) merge consideration — contribution path is a trunk-repo branch. If outside contributors ever matter, a future ADR must revisit the fork path (e.g. `pull_request_target` with hardening) rather than un-skip this guard.
- Marking the `checks` job *required* on `integration/*` is GitHub branch-protection state, not a `.github/` file — a Director console/`gh api` action, recorded here as the intended end state.

**Alternatives considered:**
- *Fix the workflow for forks* (`pull_request_target` + explicit checkout of the PR head): rejected — runs untrusted code with secrets-bearing context; the hardening cost buys nothing while all contributors are collaborators.
- *Leave auto-review unfiltered and tolerate the 401:* rejected — a red check that means "policy" reads as "breakage" and trains everyone to ignore red.
- *CI on every branch push (no filter):* rejected — burns minutes on WIP feature branches; the PR event already covers them where it matters.

---
name: ship-it
description: Canonical Aether ship sequence. Run ONLY after `verify-build` returned clean and Director confirmed "proceed." Stages, commits with §7-aligned message, pushes the branch, and opens a PR with §7-format body referencing the lane's GitHub Issue.
---

# ship-it

Canonical ship sequence for the Aether repo.

## Preconditions

- **Order:** Run `pnpm install` BEFORE staging. The install may
  update `pnpm-lock.yaml`; that update must be staged in the same
  commit as the dependency changes that triggered it. Reversing this
  order leaves the lockfile change unstaged and CI fails with
  `ERR_PNPM_OUTDATED_LOCKFILE` (see governance-log entry 6).
- **Staging is explicit (#375).** Stage the lane's files BY PATH — never
  `git add -A` or `git add .`. Blanket staging is how worktree
  scaffolding (`.lane-kickoff.md`) and stray local files end up in a
  lane's diff; PR #379 stayed clean only because it staged explicitly.
  `.lane-kickoff.md` is also gitignored (#375), but the skill does not
  assume every checkout carries that entry.
- Before committing, assert the lockfile is staged if any
  `package.json` files changed:
    `git diff --cached --name-only | grep -qE "package\.json$" && \`
    `git diff --cached --name-only | grep -q "pnpm-lock.yaml" || \`
    `(echo "package.json changed but lockfile not staged"; exit 1)`
- `verify-build` ran and returned clean.
- Director typed "clean, proceed" or equivalent.
- Lane has a GitHub Issue (`Closes #<N>`).

If any precondition fails: stop. Do not stage. Do not commit.

## Sequence

```bash
set -e
cd "$(git rev-parse --show-toplevel)"

# Stage EXPLICITLY, by path — every file the lane touched, nothing else.
# Never `git add -A` / `git add .` (#375: blanket staging ships worktree
# scaffolding; explicit paths are the fence).
git add <path> [<path> ...]

# Assert no kickoff scaffolding slipped in (if-form: grep's no-match exit
# status must not trip `set -e`).
if git diff --cached --name-only | grep -qx '.lane-kickoff.md'; then
  echo "kickoff scaffolding staged — unstage it"; exit 1
fi

git status

git commit -m "<type>(<scope>): <imperative summary>" \
           -m "$(cat <<'EOF'
<body — context, what changed, why, caveats>

Closes #<issue>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"

git push -u origin "$(git branch --show-current)"

gh pr create \
  --title "<type>(<scope>): <imperative summary>" \
  --body "$(cat <<'EOF'
## Summary
<one-paragraph user/system-visible outcome>

## Changes
- <bullet 1>
- <bullet 2>

## Verification
- `pnpm build` ✅
- `pnpm typecheck` ✅
- `pnpm lint` ✅

## Notes
<scope decisions, deferred work, follow-ups>

Closes #<issue>
EOF
)"

gh pr view --json number,url
echo "=== ship-it: PR opened ==="
```

## Reporting

Drop the PR number to Director. Do not auto-merge. Do not request review.

## Why this exists

`verify-build` and `ship-it` were one block in earlier Sprint lanes; sessions stalled between them on hostile-API days. Splitting them with a Director confirmation gate makes the failure mode survivable.

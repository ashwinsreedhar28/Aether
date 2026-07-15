---
name: verify-build
description: Canonical Aether build verification sequence. Run after any lane that modifies the repo, before opening a PR. Installs workspace deps from repo root if needed, then runs build/typecheck/lint from shell/ (where npm scripts live in this monorepo). Adds python compileall for nodes/ and core/ if any .py touched. Paste output to Director.
---

# verify-build

Canonical verification sequence for the Aether repo. Invoked at the end of every Implementer lane before `ship-it`.

## Monorepo layout note

- Repo root holds `pnpm-workspace.yaml`. No root `package.json`.
- Workspace members: `shell/`, `core/node_sdk_ts`, `nodes/*`, `daemons/raven-daemon`.
- `pnpm install` runs **from repo root** (links all workspaces).
- Build/typecheck/lint scripts live in **`shell/package.json`**, so the `pnpm <script>` commands run **from `shell/`**.

## Sequence

```bash
set -e
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Install workspace deps if package files changed OR node_modules missing (fresh worktree)
if git diff main --name-only | grep -qE '(package\.json|pnpm-lock\.yaml)$' \
   || [ ! -d "$REPO_ROOT/node_modules" ] \
   || [ ! -d "$REPO_ROOT/shell/node_modules" ]; then
  echo "[verify] pnpm install (workspace root)"
  pnpm install
fi

cd "$REPO_ROOT/shell"

echo "[verify] pnpm build"
pnpm build

echo "[verify] pnpm typecheck"
pnpm typecheck

echo "[verify] pnpm lint"
pnpm lint

cd "$REPO_ROOT"
if git diff main --name-only | grep -qE '\.py$'; then
  echo "[verify] python compileall"
  # -x excludes any vendored venv under the daemons trees (the main checkout
  # carries daemons/*/.venv; worktrees don't).
  python -m compileall -x '\.venv' nodes/ core/ daemons/raven-core/ 2>&1 | grep -v "^Listing" || true
fi

echo "=== verify-build: clean ==="
```

## Additional clauses

- Run `pnpm -r typecheck` from the repo root, not just `pnpm typecheck`
  in `shell/`. CI runs the recursive form; local should match. (Lesson:
  PR #75 passed shell-only typecheck locally, failed CI when
  `pnpm -r typecheck` exposed unresolved types for a new workspace
  package. See governance-log entry 7.)
- After `pnpm install`, assert the lockfile is in a clean state before
  proceeding to build/typecheck/lint:
    `git diff --quiet pnpm-lock.yaml || (echo "lockfile uncommitted"; exit 1)`
  This catches the order-of-operations bug where `git add -A` runs
  before `pnpm install`, leaving lockfile changes unstaged. (Lesson:
  PR #74 failed CI with `ERR_PNPM_OUTDATED_LOCKFILE`. See governance-log
  entry 6.)

## Reporting

Paste the full output to Director. Do NOT proceed to `ship-it` until Director says "clean, proceed."

## Failure modes

- `pnpm build` TS error → report file:line, stop.
- `pnpm typecheck` red → report, stop.
- `pnpm lint` warning → report, ask Director (warnings don't block; errors do).
- `python -m compileall` syntax error → report, stop.

## Why this exists

Sprint 4 lanes stalled repeatedly between verify and PR-open. Splitting into `verify-build` (this skill) + `ship-it` with an explicit Director confirmation gate eliminated the stall pattern.

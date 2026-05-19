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
  python -m compileall nodes/ core/ 2>&1 | grep -v "^Listing" || true
fi

echo "=== verify-build: clean ==="
```

## Reporting

Paste the full output to Director. Do NOT proceed to `ship-it` until Director says "clean, proceed."

## Failure modes

- `pnpm build` TS error → report file:line, stop.
- `pnpm typecheck` red → report, stop.
- `pnpm lint` warning → report, ask Director (warnings don't block; errors do).
- `python -m compileall` syntax error → report, stop.

## Why this exists

Sprint 4 lanes stalled repeatedly between verify and PR-open. Splitting into `verify-build` (this skill) + `ship-it` with an explicit Director confirmation gate eliminated the stall pattern.

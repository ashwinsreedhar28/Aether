#!/usr/bin/env bash
# lane-done.sh — post-merge ritual: sync trunk, prune worktree + branch
# NOTE: flip TRUNK default to main at arc promotion.
set -euo pipefail
BRANCH="${1:?usage: scripts/lane-done.sh <branch> [trunk]}"
TRUNK="${2:-integration/viewer}"
cd "$(git rev-parse --show-toplevel)"
git checkout "$TRUNK"
git pull
WT=$(git worktree list --porcelain | grep -B2 "branch refs/heads/$BRANCH" | awk '/^worktree /{print $2}' || true)
[ -n "${WT:-}" ] && git worktree remove "$WT" --force
git branch -D "$BRANCH" 2>/dev/null || true
git push origin --delete "$BRANCH" 2>/dev/null || true
echo "lane-done: $BRANCH cleaned; $TRUNK synced."

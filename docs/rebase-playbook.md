# The rebase playbook

Aether is trunk-based with short-lived feature branches (CLAUDE.md §5), so every
lane eventually rebases onto a `main` that moved while it was open, and parallel
lanes collide on the same handful of append-heavy files. The conventions for
doing that cleanly used to live only in chat — oral law. This doc writes them
down.

Writing them down is the point: the `aether-rag` corpus can only retrieve law
that is *written* (CLAUDE.md §13.13). This file is indexed
([`CORPUS_GLOBS`](../daemons/aether-rag/rag_lib.py)), so a query like *"How do we
resolve CHANGELOG conflicts?"* — the RAG eval's Q1 — now lands here instead of on
nothing.

The short version: **appends are unions, shared scalars are recounted, pushes
are leased, and you smoke before you rebase and verify after.**

## CHANGELOG: keep-all

When two branches both add bullets under `[Unreleased]`, a rebase conflicts on
the same region. **Keep both.** A CHANGELOG entry is an *append*, never a
replacement — the resolution is the union of both branches' bullets, each filed
under the right subsection (`Added` / `Changed` / `Fixed` / `Removed`), never
"take mine" or "take theirs." Dropping a side's entry silently erases a shipped
change from the history, and nothing downstream will flag it (a passing
typecheck never reads the CHANGELOG). When in doubt, both bullets survive.

This is the canonical answer to *"how do we resolve a CHANGELOG conflict"*:
concatenate, don't choose.

## prompts.json / manifest.yaml: keep-both, distinct sections

`daemons/raven-core/raven_core/prompts/prompts.json` and `manifest.yaml` are the
other two append-heavy collision files, and they take the same union rule. When
two lanes each add to them — a new tool entry plus its instruction section in
`prompts.json`, a new node block plus its edges in `manifest.yaml` — **keep both
additions as distinct sections.** Two new nodes means two node blocks; two new
tools means two tool entries and two instruction sections. A rebase conflict here
is two adjacent inserts at the same anchor; resolve it by concatenation,
preserving each section whole, never by letting one lane's section overwrite the
other's.

The one thing that is *not* kept-both is a **shared scalar** the two sections
both touch — the tool count, an `N nodes` claim. That falls under
*recount-don't-inherit* below, not keep-both.

## Recount, don't inherit (shared facts)

When two branches independently edit the same scalar — raven's tool count (which
#168 bumped while a parallel calendar lane also moved it), a port allocation, an
enum maximum, an `N nodes` claim — **neither branch's value is correct at
merge.** Each counted from its own starting point, blind to the other's
addition, so adopting either number inherits an undercount. RE-DERIVE the fact
from ground truth at the merge point (recount the actually-registered tools);
never trust the number written in either branch.

Keep-both (the rule above) governs the two *distinct sections*; recount governs
the *shared scalar* those sections both increment. They are complementary, not
in tension. The prevention side of this is CLAUDE.md §11 heuristic 6 (reserve
space — or drop the brittle count entirely, as the prompt's tool-count wording
was) and this is the merge-time cure. Full lesson:
[`docs/governance-log.md`](governance-log.md) — *"Recount, don't inherit —
parallel editors of one fact"* (2026-06-04).

## Smoke-then-rebase ordering

Smoke your branch's change **in isolation, before** rebasing onto a moved
`main`. A failure observed on the isolated branch is attributable to *your
change*; a failure observed only after the rebase is ambiguous — your change, or
the rebase pulling in someone else's. Establish the green-on-my-diff signal
first, then rebase. This pairs with the governance log's *smoke the bits you
ship* / *stale family* lessons: a rebase moves the bits, so the pre-rebase smoke
is what pins the behavior to your diff rather than to the merge.

## Re-verify post-rebase

A clean pre-rebase build does **not** survive the merge of someone else's change
for free. A rebase can bring in a new workspace package (which needs
`pnpm install` before the build resolves — CLAUDE.md §10), a new manifest edge, a
renamed surface, or a CHANGELOG / `prompts.json` collision you just resolved by
hand. Re-run the verification gate **after** the rebase, not only before:
`pnpm install` if any `package.json` or lockfile moved, then `verify-build` (or
the lane's scoped verification). Treat the post-rebase tree as a fresh state to
prove green, never as a known-good one carried over.

## Force-push with lease

A rebase rewrites the branch's history, so the next push is non-fast-forward.
Use `git push --force-with-lease`, **never** a bare `git push --force`.
`--force-with-lease` refuses the push if the remote moved since you last fetched
— it protects a commit you didn't know was there (a review fixup pushed onto your
branch, an auto-commit). Bare `--force` clobbers unconditionally and can drop a
collaborator's work. Lease, never bare.

## The ordering at a glance

1. **Smoke in isolation** — green-on-my-diff before touching `main` (smoke-then-rebase).
2. **Rebase** onto the updated `main`.
3. **Resolve collisions** — keep-all the CHANGELOG; keep-both the distinct
   `prompts.json` / `manifest.yaml` sections; **recount** any shared scalar (tool
   count, `N nodes`) from ground truth.
4. **Re-verify** — `pnpm install` if packages moved, then the build/verification
   gate, on the *post-rebase* tree.
5. **Push** with `--force-with-lease`.

---

*This doc is part of the `aether-rag` corpus. When a new rebase convention earns
its weight, add it here so the index can retrieve it — an unwritten rule is one
`search_corpus` cannot return (CLAUDE.md §13.13).*

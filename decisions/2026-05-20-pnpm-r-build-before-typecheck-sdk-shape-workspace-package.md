## [2026-05-20] ADR: `pnpm -r build` before typecheck for SDK-shape workspace package auto-discovery

**Status:** Accepted (enacted 2026-05-19 — `.github/workflows/ci.yml` and `shell/package.json` updated; see CHANGELOG entry)

**Decided by:** Architect + Director (Sprint 4 governance batch 4)

**Context:** Sprint 4 Wave 2 introduced `@aether/macos-applescript` as
the second SDK-shape workspace package (after `@aether/mesh-node-sdk`).
SDK-shape packages are consumed by other workspace packages for their
TypeScript types. CI's `pnpm -r typecheck` step requires consumer
packages' types to be resolvable, which requires the SDK packages'
`dist/*.d.ts` files to exist when typecheck runs.

The current `.github/workflows/ci.yml` has a hardcoded `pnpm --filter`
pre-build step listing exactly two packages (`@aether/mesh-node-sdk`,
`@aether/host-notifications`). Adding `@aether/macos-applescript` in
PR #75 missed this list; CI failed with `Cannot find module
'@aether/macos-applescript' or its corresponding type declarations`.
Fixed by adding a third `pnpm --filter` entry, but the underlying
maintenance trap remains: every new SDK-shape package adds a line to
this hardcoded list.

**Decision:** Replace the hardcoded `pnpm --filter` chain in the
ci.yml pre-build step with `pnpm -r build`. This builds every
workspace package in topological order before typecheck runs,
auto-discovering new SDK-shape packages without further workflow edits.

**Consequences:**

- All workspace packages build in CI before typecheck. Eliminates the
  "forgot to add to pre-build list" class of bugs for SDK-shape
  packages.
- Slightly slower CI (~10-20s for the additional builds of
  daemon-node packages that were previously built ad-hoc or not at all).
  Trade considered acceptable: maintenance burden is the higher cost.
- `shell/package.json`'s `prebuild` filter and
  `shell/electron/main/services/staleSpawns.ts` cleanup list remain
  hand-curated. Separate decisions pending; both have lower failure
  impact than the CI pre-build (shell prebuild only affects
  electron-vite-time package readiness; staleSpawns only affects
  hard-crash recovery hygiene).
- Future workspace packages with side-effects in their build scripts
  could affect CI timing or correctness. Audit before adopting.

**Alternatives considered:**

- **Status quo (hardcoded list, document maintenance contract).** The
  list has been forgotten three times in one sprint despite the
  contract being implicit. Cost: ongoing CI failures + reactive fixes.
- **Tag SDK-shape packages with a custom `"sdk": true` flag in
  `package.json`** and use a custom script that builds tagged packages.
  Requires custom tooling; not standard pnpm. Rejected.
- **Use TypeScript project references** (`tsconfig.json` `references`
  field) so consumer packages reference source-level types. Standard
  TS pattern for monorepos. More invasive; affects all consumer
  tsconfigs. Reconsidered in a future ADR if `pnpm -r build` proves
  insufficient.

**Implementation:** Deferred to a follow-up PR (the workflow change
itself is one line; not in scope for this governance lane).

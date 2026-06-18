### Fixed
- Research node now registers with Core on boot (#358): the research lane
  (#353) shipped without `MESH_RESEARCH_SECRET` in coreManager's env block,
  so Core's `_resolve_secret` fell through to its SHA256 autogen fallback
  while nodeManager handed the spawned child a fresh hex32 from
  `generateMeshSecrets`. The mismatch surfaced as a `401 bad_signature` at
  register, a `denied_node_unreachable` 503 to every Research surface
  invocation, and an "unset env var" warning in `core.log` on every boot.
  Fix: inject the secret into Core's env at manifest load, the same shape as
  every other TS node. Step 8 of `docs/new-node-pattern.md` gains a callout
  about reviewer-cell-blindness for this class. Closes #358.

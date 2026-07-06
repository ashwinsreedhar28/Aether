### Added
- Mesh smoke harness for the research node (#366): `pnpm --filter
  @aether/research harness` boots a real Python Core on ephemeral
  credentials (per-run `randomBytes` for `ADMIN_TOKEN`, `MESH_CORE_SECRET`,
  `MESH_RESEARCH_SECRET`, and the probe's identity secret — nothing
  hardcoded, nothing persisted), exercises the admin token against
  `/v0/admin/metrics` (200 with, 401 without), spawns the built research
  node hermetically (temp `AETHER_DATA_DIR`, `ANTHROPIC_API_KEY` stripped so
  the instrument can never spend), and drives all three surfaces through a
  probe `MeshNode`: recent happy path, Core's schema gate
  (`denied_schema_invalid` before the node ever sees the envelope), the
  node-side `MeshDeny` path on search and brief, and a live Semantic Scholar
  search where upstream weather (`rate_limited`/`upstream`) records SKIP,
  not FAIL. Stdout is a grep-stable transcript — every line `HARNESS
  BOOT|CHECK|OK|SKIP|FAIL|RESULT` with `key=value` fields, child output
  forwarded to stderr under `[core] `/`[research] ` prefixes — and the exit
  code mirrors the verdict. `--deliberate-failure` appends a check expecting
  a deny the node will never send, proving the instrument can report FAIL
  (a gate tool that can only say PASS is not evidence). Transcript +
  credential law recorded in an ADR. Closes #366.

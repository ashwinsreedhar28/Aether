## [2026-07-06] ADR: Harness transcript contract + ephemeral credentials (#366)

**Status:** accepted

**Decided by:** Architect (spawn spec recorded on #366), implementation on
`lane/issue-366`.

**Context:** The research node had no end-to-end gate: nothing proved that a
real Core would boot, that its schema gate fires before the node does, that
the node's `MeshDeny` path actually reaches an invoking peer, or that the
whole loop survives with zero standing credentials. The SDK's round-trip
vitest (`core/node_sdk_ts/test/round-trip.test.ts`) proved the Core-boot
machinery but drives synthetic echo nodes, not a shipped node. Ad-hoc manual
runs against the dev mesh reuse long-lived dev secrets and produce prose
logs a reviewer cannot grep or a script cannot assert on. And an instrument
that has never been seen to fail is not evidence — a gate that can only say
PASS proves nothing about the runs where it says PASS.

**Decision:** Mesh smoke harnesses are standalone executables (first
instance: `nodes/research/src/harness.ts`, run via the package's `harness`
script) bound by two contracts:

*Ephemeral credentials.* Every secret the run needs — `ADMIN_TOKEN`,
`MESH_CORE_SECRET`, the node identity secrets, the probe's identity secret —
is generated per run via `randomBytes`, injected only into the spawned
processes' environments, and dies with the temp dir. Nothing is hardcoded,
read from the developer's environment, or persisted. Core's refusal of an
unset/legacy `ADMIN_TOKEN` is exercised positively AND negatively (metrics
with the token → 200, without → 401), and the node under test runs
hermetically: temp `AETHER_DATA_DIR`, `ANTHROPIC_API_KEY` stripped so a gate
run can never spend money or touch a personal key.

*Grep-stable transcript.* Stdout is exclusively transcript: every line is
`HARNESS <VERB> key=value ...` with the fixed verb set `BOOT | CHECK | OK |
SKIP | FAIL | RESULT`, whitespace-free bounded values, no timestamps, no
prose. Child-process output is forwarded to stderr under `[core] ` /
`[research] ` prefixes. The final line is always `HARNESS RESULT
verdict=PASS|FAIL ok=N skip=N fail=N` and the exit code mirrors the verdict
(0/1; 2 for usage errors). SKIP is reserved for upstream weather (a
third-party rate-limit/5xx surfaced as a clean deny) — upstream weather is
not a mesh failure. Every harness ships a `--deliberate-failure` mode that
appends a check expecting a deny the node will never send, so the FAIL
machinery itself is demonstrable on demand.

**Consequences:**
- A reviewer greps `HARNESS RESULT` (or any single check by `name=`) out of
  a gate comment and trusts it; a script asserts on exit code alone. The
  transcript is diffable across runs because nothing in it is
  time-or-machine dependent (ports appear only on BOOT lines).
- Leaving a personal `ANTHROPIC_API_KEY` or dev `ADMIN_TOKEN` in the
  environment cannot leak into gate evidence — generated values override
  inherited ones by construction.
- The Core-boot + probe machinery is deliberately shaped like the SDK
  round-trip vitest so a third instance can extract a shared helper (§15:
  no abstraction before the third use); generalizing to arbitrary nodes is
  explicitly deferred.
- First live run already paid for the instrument: it caught that deny names
  (`research_bad_query`, …) were silently clobbered on the wire by a
  `reason:` key inside `MeshDeny` details (the SDK payload is `{ reason:
  <deny name>, ...details }`), dead-coding every consumer that switches on
  them. Node authors must not use `reason` as a details key; the research
  node now carries the human-readable cause under `detail`.

**Alternatives considered:**
- *A vitest suite instead of a standalone executable.* Rejected: the gate
  artifact is a transcript a human pastes into a PR/issue comment and greps;
  vitest owns stdout, interleaves reporter output, and buries the verdict in
  a framework summary. The round-trip vitest stays the SDK's contract test;
  the harness is an operator instrument.
- *Reusing dev-mesh credentials (the running Core, `data/aether.db`).*
  Rejected: a gate must prove cold-boot on zero standing state; riding the
  dev mesh both contaminates the instrument with local state and puts real
  secrets into pasted transcripts.
- *Free-prose logging with a PASS/FAIL last line.* Rejected: only the last
  line would be assertable; every intermediate claim ("the schema gate
  fired") would be unverifiable prose. The fixed-verb `key=value` grammar
  makes each check's evidence independently greppable.
- *Skipping the deliberate-failure mode as paranoia.* Rejected by the spec's
  own rationale: an instrument never observed failing is indistinguishable
  from one hardwired to PASS.

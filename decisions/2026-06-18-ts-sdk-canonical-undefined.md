## [2026-06-18] ADR: TS SDK canonical must match wire-roundtrip canonical (#359)

**Status:** accepted

**Decided by:** Architect (spec on #359), implementation on `lane/issue-359`.

**Context:** The TS mesh-node SDK (`@aether/mesh-node-sdk`) was 401'ing its own
responses with `bad_signature` on every invocation that carried an
undefined-valued optional. `finance.log` on a clean boot: register OK, then
`[mesh-node-sdk] [finance] respond failed: MeshError: mesh error 401:
{"error":"bad_signature"}` on every response. The skew across nodes mapped to
how many undefined optionals their typical payloads carry — `finance` (whose
`Quote` has six `number | undefined` fields from Stooq-fallback rows and
partial Yahoo responses) hit it constantly; `github` (1) and `lanes` (2) hit
it occasionally; `host_notifications`, `music`, `sports`, `news_feeds`,
`weather`, `digest` never (0).

Root cause: `core/node_sdk_ts/src/canonical.ts`'s object branch encoded an
undefined-valued key as `"key":null`, but `JSON.stringify({k: undefined})`
drops the key entirely. The sender signs over the canonical-with-`null` string,
then puts `JSON.stringify(envelope)` (key gone) on the wire. Core parses the
wire JSON into a dict without the key, re-canonicalizes via
`json.dumps(sort_keys=True, separators=(",", ":"))` (`core/core/core.py:171`),
and computes an HMAC over a string that never had the key. Sender HMAC ≠
receiver HMAC → 401. The Python SDK is unaffected: Python has no `undefined`,
so a Python sender's canonical and Core's re-canonical always agree. Register
worked everywhere because the register body (`{node_id, timestamp, signature}`)
carries no undefined values.

**Decision:** Establish the load-bearing invariant for any signing-relevant
canonicalization in this codebase:

> `canonical(x)` MUST equal `canonical(JSON.parse(JSON.stringify(x)))`.

The wire carries `JSON.stringify(x)`; the receiver re-canonicalizes what it
parses. Signing over anything `JSON.stringify` would not emit guarantees a
byte-for-byte divergence at the verifier. Concretely for #359: the object
branch of `canonicalValue` filters undefined-valued keys before sorting,
mirroring `JSON.stringify`'s drop-undefined-keys behavior. The top-level
`v === undefined → 'null'` branch is left intact on purpose — it governs array
elements, and `JSON.stringify([undefined])` does emit `[null]`, so that branch
is already roundtrip-correct. The invariant is named in the `canonical.ts`
file-header comment, which links here; a round-trip property test
(`test/canonical.test.ts`) guards it.

**Consequences:**
- Every TS node response carrying an undefined optional now verifies. Finance
  (the heaviest hitter), github, and lanes stop 401'ing; the Stocks app's live
  fetch succeeds without the "Live fetch failing" banner.
- The invariant generalizes beyond `undefined`: any future signing-relevant
  field whose JSON wire form differs from its in-memory canonical form (e.g. a
  value type that `JSON.stringify` serializes specially) is covered by the same
  rule — test the roundtrip, don't re-derive the bug.
- The fix is signature-affecting but backward-compatible across the mesh:
  Python senders were already roundtrip-correct, and the only payloads whose
  TS signature *changes* are exactly the ones that were failing (their old
  signature was rejected anyway). No node needs a coordinated upgrade.
- A round-trip property test now exists for the SDK independent of the
  Python-dependent integration test (`test/round-trip.test.ts`), so the
  invariant is checked even on machines without the Python deps.

**Alternatives considered:**
- *Change the top-level `undefined → 'null'` branch instead.* Rejected: that
  branch is correct for array elements (`JSON.stringify([undefined]) === '[null]'`).
  Collapsing undefined to absent there would make canonical diverge from the
  wire in the array case — re-introducing the same class of bug from the other
  side. The divergence is specific to object keys, so the fix belongs in the
  object branch.
- *Strip undefined optionals in each node handler before responding.* Rejected:
  it pushes a SDK correctness invariant onto every current and future node
  author, is easy to forget (the bug would silently return), and does not
  capture the general principle. The signing layer is the right place to
  guarantee canonical = wire-roundtrip canonical.
- *Switch canonical to wrap `JSON.parse(JSON.stringify(x))` itself.* Rejected
  as a heavier change than warranted: it adds a serialize+parse round-trip to
  every sign call and still needs the ASCII-escape hand-rolling for
  Python-parity. The one-line filter achieves the same invariant for the only
  case that diverges today, and the property test pins the rest.

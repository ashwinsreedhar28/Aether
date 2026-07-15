## [2026-07-14] ADR: Deny wire `reason` is always the deny name; causes ride under `detail:` (#371)

**Status:** accepted

**Decided by:** Architect (ratified spec + ratification amendment on #371),
implementation on `lane/issue-371`.

**Context:** Both mesh-node SDKs built a MeshDeny's `kind="error"` payload as
`{ reason: <deny name>, ...details }`, so any `reason` key inside a handler's
details clobbered the deny name on the wire. Consumers switch on deny names
(`research_bad_query`, `github_no_token`, …) — under the collision they
received the free-text cause instead and never matched. The #366 harness
caught it live for the research node on its first run (fixed node-side at
fea4f49); finance and github carried the same collision latent. This is the
same invariant class the 2026-06-18 canonical ADR established one layer down
(`decisions/2026-06-18-ts-sdk-canonical-undefined.md`: what is signed must be
what the receiver re-canonicalizes): a payload's semantics must survive the
trip from `throw` in a handler to the consumer switching on it.

**Decision:** Two-part wire-contract invariant for deny error payloads:

> 1. The `reason` key of a deny error payload is ALWAYS the deny name. Both
>    SDKs build the payload as `{ ...details, reason: denyName }` — details
>    spread first, so the deny name wins every collision.
> 2. The human-readable cause rides under `detail:` inside details — never
>    under a `reason:` details key.

Enforced at the SDK layer by extracted single-construction-site builders:
`denyPayload()` (`core/node_sdk_ts/src/types.ts`, exported from the SDK
index) and `deny_payload()` (`core/node_sdk/__init__.py`). Cross-SDK parity
is pinned by `core/node_sdk_ts/test/deny-payload.test.ts` and
`core/node_sdk/test_deny_payload.py`, which build the same colliding fixture
and assert the same canonical string literal
(`{"code":7,"detail":"human-readable cause","reason":"example_denied"}`) —
TS via the SDK's `canonical()`, Python via the
`json.dumps(sort_keys=True, separators=(",", ":"))` form Core uses to
re-canonicalize wire JSON. Node-author guidance lives in
`docs/new-node-pattern.md` ("MeshDeny payload convention" + gotcha 11).

**Consequences:**
- Deny names reach the wire unconditionally; consumers switching on `reason`
  (shell friendly-error maps, raven voice tools, README contracts) can trust
  it. A colliding details `reason:` key is now silently dropped rather than
  clobbering — the safe failure direction, since the switchable name survives.
- Finance and github's inner `reason:` keys are renamed to `detail:` in the
  same lane, so their causes keep reaching the wire. Four nodes still carry
  details `reason:` keys whose causes are silently dropped post-flip
  (news_feeds ×6, sports ×1, host_notifications ×1, macos_mail ×1) —
  dispositioned by the #371 ratification amendment to a separate lane.
- Python's `MeshDeny(reason, **details)` already rejects a `reason` kwarg at
  construction (TypeError), so the trap is TS-only in practice; the Python
  flip is cross-SDK parity and defense against post-construction mutation.
- Any future SDK, transport, or payload builder must preserve both halves of
  the invariant; the parity tests are the template for pinning a new
  implementation to the same canonical bytes.

**Alternatives considered:**
- *Throw (or assert) on a colliding `reason` details key instead of silently
  overwriting.* Rejected: the deny path is the error-reporting path — making
  it able to fail turns a readable error into a `handler_exception` (or a
  crash) exactly when the caller most needs the structured deny. Silent-drop
  preserves the switchable name; the documented convention plus the node-side
  `detail:` renames make the drop unreachable in conforming code.
- *Fix only the node-side keys (the research-style fix) and leave the SDK
  spread order alone.* Rejected: leaves the trap armed for every current and
  future node author — the exact class-vs-instance trade the 2026-06-18 ADR
  resolved the same way (fix the layer, not each caller).
- *Move the deny name to a differently-named wire key (e.g. `deny:`) so name
  and cause can coexist under their old keys.* Rejected: breaks every
  existing consumer switching on `reason` across shell, raven, and node
  READMEs for zero expressive gain over the `detail:` convention.

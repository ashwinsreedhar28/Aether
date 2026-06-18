### Fixed
- TS mesh-node SDK no longer 401s its own responses (#359): the SDK's
  canonicalization emitted `"key":null` for object keys whose value was
  `undefined`, while `JSON.stringify` drops those keys entirely from the wire
  JSON. The signature computed on the sender and the signature Core verifies by
  re-canonicalizing the parsed wire JSON diverged byte-for-byte for any payload
  carrying an undefined optional — heaviest hitter the finance node's `Quote`
  (six `number | undefined` fields from Stooq-fallback rows and partial Yahoo
  responses), with github and lanes hit occasionally. Register was unaffected
  (its body carries no undefined values). Fix: a one-line filter in the object
  branch of `canonical.ts` mirroring `JSON.stringify`'s drop-undefined-keys
  behavior, a round-trip invariant test (`canonical(x)` must equal
  `canonical(JSON.parse(JSON.stringify(x)))`), and an ADR recording that
  principle. Closes #359.

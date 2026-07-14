### Fixed
- MeshDeny error payloads now spread details BEFORE the deny name in both
  SDKs (`{ ...details, reason }`), so a `reason:` key inside deny details
  can no longer clobber the deny name on the wire (#371) — the SDK-level
  generalization of #366's research-node fix. The built payload is
  parity-pinned across the TS and Python SDKs to the same canonical string
  (`test/deny-payload.test.ts` / `test_deny_payload.py`). Finance and
  github's latent collisions are renamed to `detail:` per the research
  convention (finance: `symbol_required`/`query_required` denies and the
  three `malformed` QuoteClientError sites; github: `github_api_error` /
  `github_unreachable` causes), and the convention is documented in
  docs/new-node-pattern.md ("MeshDeny payload convention" + gotcha 11).

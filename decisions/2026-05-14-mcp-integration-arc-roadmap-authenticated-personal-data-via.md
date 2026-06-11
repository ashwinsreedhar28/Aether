## [2026-05-14] MCP integration arc roadmap: authenticated personal data via MCP

**Status:** accepted
**Decided by:** Director (Architect-recommended)
**Context:** Aether's existing data nodes (news_feeds, finance,
weather, host_notifications, memory, digest) all ingest from sources
where we own the pipeline — public RSS, public APIs, internal state.
The next class of data is authenticated personal data: calendar
events, email inbox state, files, task lists. These do not fit the
mesh-node-with-fetcher pattern cleanly because they require OAuth
flows, per-user tokens, and provider-defined contracts that we do
not control. Building each as a bespoke mesh node would duplicate
OAuth scaffolding per provider and ship a different schema shape for
every connector. Anthropic's Model Context Protocol (MCP) is now an
open standard for exactly this shape — third-party authenticated
tool surfaces — and Aether can be an MCP client alongside its
existing mesh-client role.

**Decision:** Adopt MCP as the integration substrate for third-party
authenticated personal data. Specifically:
- **Architectural split.** Mesh nodes remain the substrate for data
  Aether owns the pipeline for (public-source ingestion, internal
  state, composer nodes). MCP becomes the substrate for third-party
  authenticated data (provider owns the contract and the auth).
- **Five-piece arc, sequenced.** (1) MCP client substrate in
  raven-core (`feat/raven-mcp-client`); (2) Google Calendar via MCP
  (`feat/mcp-calendar`, OAuth flow likely its own PR); (3) Gmail via
  MCP (`feat/mcp-gmail`); (4) Google Drive via MCP (`feat/mcp-drive`);
  (5) digest integration adding MCP-backed sections to morning /
  evening briefings (`feat/digest-mcp-sections`). Recommended order:
  1 → 2 → (3 and 4 in parallel) → 5.
- **Auth boundary.** Electron shell handles OAuth (system-browser
  launch + localhost redirect intercept). Tokens land in macOS
  Keychain under `com.aether.app`. raven-core reads tokens from
  Keychain when invoking MCP servers. Shell handles the UX;
  raven-core handles the protocol; Keychain is the secret-store
  boundary.
- **Privacy contract.** Authenticated data is fetched on demand, not
  persisted locally beyond the OAuth refresh token in Keychain.
  Aether transmits authenticated data only to Gemini Live as part of
  the existing voice-processing channel. Local LLM mediation of
  authenticated data (so Gemini sees only summaries) is documented
  as a future direction, out of scope for v1.
- **Scope-out for v1 of the arc.** Microsoft 365 / Outlook (Google
  ecosystem first), Apple HealthKit / Notes / iCloud (no MCP surface
  today), chat platforms (different interaction model), local file
  indexing (separate question), multi-account (one Google account
  for v1), MCP server hosting (Aether is a client only).

**Consequences:**
- raven-core grows an MCP-client capability alongside its existing
  mesh-client role; future authenticated integrations land as
  config-file entries rather than bespoke nodes.
- The Electron shell takes on first-party responsibility for OAuth
  UX (system-browser launch, redirect capture, Keychain write) —
  net-new surface area for the shell.
- The digest composer gains a hybrid fan-out shape: mesh upstreams
  (news, finance, weather) plus MCP upstreams (calendar, email,
  drive activity) composed into the same `BriefingSection[]` shape.
  The `Promise.allSettled` + per-upstream-timeout pattern from PR
  #27 generalizes cleanly; an MCP-side failure ships an
  `available: false` section the same way a mesh-side failure does.
- Privacy posture for the project shifts: pre-MCP, the only
  authenticated boundary was Gemini Live (voice in / voice out);
  post-MCP, Aether persists OAuth refresh tokens locally. Keychain
  scoping (`com.aether.app`) and the on-demand fetch contract are
  the user-facing guardrails.
- Commits Aether to being an MCP client; does not commit to running
  MCP servers (explicitly out of scope).

**Alternatives considered:**
- *Custom per-provider mesh nodes.* Rejected: each integration
  re-implements OAuth, token refresh, and a bespoke schema; doesn't
  scale across providers; each connector becomes its own special
  case maintained in Aether's tree rather than the provider's.
- *Cloud-mediated MCP (run MCP servers in a hosted Aether cloud,
  proxy from the local app).* Rejected: Aether is local-first; auth
  tokens and authenticated data should stay on the user's machine.
  Hosted MCP would invert the trust boundary.
- *Local-LLM mediation before Gemini in v1 (summarize locally, send
  only the summary to Gemini).* Deferred to a future arc rather than
  rejected. v1 ships the simpler shape (Gemini sees the
  authenticated payload, same channel as voice today); local
  mediation is documented in the roadmap as a future direction once
  a suitable local model and the latency budget are in hand.
- *Microsoft 365 first / Microsoft + Google in parallel.* Rejected
  for v1 of the arc — Director uses the Google ecosystem; parallel
  ecosystems double the arc's surface area for no v1 user benefit.
  A Microsoft arc can run in parallel later if Director adds it.

See `docs/mcp-integration-arc-roadmap.md` for the full design (mesh-
vs-MCP rationale, per-piece scope, auth flow, privacy posture, open
implementation-time questions).

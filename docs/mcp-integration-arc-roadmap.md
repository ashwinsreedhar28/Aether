# MCP integration arc roadmap

## Context

Aether today has data nodes that ingest from public sources (news
RSS, finance APIs, weather). The next class of data is
authenticated personal data: calendar events, email inbox state,
files, task lists. These don't fit the mesh-node-with-fetcher
pattern cleanly because they require OAuth flows, per-user tokens,
and provider-specific contracts.

The Model Context Protocol (MCP) is Anthropic's open standard for
tool integration. MCP servers expose authenticated data sources as
callable tools that an LLM (or any MCP client) can invoke. Aether
can be an MCP client — voice queries route through Gemini Live,
which can call MCP-exposed tools alongside the existing mesh
surfaces.

This roadmap captures:
1. The mesh-vs-MCP architectural decision (where each lives, how
   they compose)
2. The planned MCP integrations (Calendar, Gmail, Drive first;
   Notion/Linear/etc later)
3. The auth flow design (which subsystem handles OAuth, where
   tokens live)
4. The privacy posture for authenticated personal data
5. The implementation PR sequence

## Mesh vs MCP — the architectural decision

**Mesh nodes** are for data Aether owns the pipeline for:
- Public-source ingestion (RSS, public APIs)
- Internal data (memory, digest composition)
- Local state (host notifications)

**MCP servers** are for third-party authenticated data:
- The data owner is the provider (Google, Microsoft, Notion, etc.)
- Auth is per-provider, not per-Aether-feature
- The contract is defined by the MCP server, not by Aether

The split is essentially: "did we write the fetcher, or are we
consuming someone else's authenticated surface?"

Concretely:
- news_feeds (mesh): RSS feeds, our parser, our schema
- finance (mesh): Yahoo/Stooq, our fetcher, our shape
- weather (mesh): Open-Meteo, our fetcher
- calendar (MCP): Google Calendar's MCP server, their schema, their
  auth
- gmail (MCP): Google's MCP server (or Microsoft's for Outlook)
- drive (MCP): Google Drive MCP server

Voice routes through both transparently. Gemini Live's tool list
includes mesh-backed tools (news_recent, finance_quote, weather_
current) and MCP-backed tools (calendar_events, gmail_recent).
From the user's perspective, asking "what's on my calendar today"
feels identical to "what's the latest tech news." Both are voice
queries with structured responses.

## The five integrations (sequential within the arc)

### Piece 1: MCP client substrate in raven-core

raven-core gains the ability to be an MCP client — discover, connect
to, and call MCP servers. Adds the @modelcontextprotocol/sdk
dependency (or equivalent Python SDK).

Configuration: MCP server connection info lives in a config file
that lists each server's transport (stdio, HTTP), command/URL, and
auth setup. Initial config is empty; subsequent pieces add servers.

PR shape: `feat/raven-mcp-client` — ~1 PR.

### Piece 2: Google Calendar via MCP

First real MCP integration. Adds Google's calendar MCP server (or
a community-maintained one if Google's official isn't available
yet) to the config. Auth flow: OAuth via system browser, tokens
stored in macOS Keychain.

Voice tools: `calendar_today` ("what's on my calendar today"),
`calendar_next` ("what's my next meeting"), `calendar_search`
("when is the design review").

PR shape: `feat/mcp-calendar` — ~1-2 PRs (OAuth flow likely
warrants its own PR).

### Piece 3: Gmail via MCP

Inbox state. Recent threads. Unread count. Voice tool surfaces:
`email_recent` ("any new email"), `email_search` ("find the thread
from Sarah about Q4").

PR shape: `feat/mcp-gmail` — ~1-2 PRs.

### Piece 4: Google Drive via MCP

Recent docs, search, mention queries. Voice tool: `drive_search`
("pull up the design mockups doc"), `drive_recent` ("what did I
work on yesterday").

PR shape: `feat/mcp-drive` — ~1 PR.

### Piece 5: Digest integration

The digest composer (PR #27) currently fans out to news_feeds +
finance + weather (post-Lane 4). Adds MCP-backed sections:
- Morning: today's calendar events (top 3-5)
- Morning: unread email count (just the count, not content)
- Evening: completed-today summary (from calendar + Drive activity)

PR shape: `feat/digest-mcp-sections` — ~1 PR.

## Auth flow design

OAuth flows for the user-facing app are the new piece. Decision: the
Electron shell handles OAuth via a system-browser launch + redirect
intercept. Tokens land in macOS Keychain under the com.aether.app
identifier. raven-core (the daemon side) reads tokens from Keychain
when invoking MCP servers.

This means:
- Shell handles the OAuth UI/UX
- raven-core handles the MCP protocol
- Keychain is the secret-store boundary

Workflow:
1. User says "set up calendar" or clicks Settings → Add Connector →
   Google Calendar
2. Shell opens system browser to OAuth URL
3. User authorizes in their Google account
4. Browser redirects to localhost:port (one-time captured by shell)
5. Shell extracts token, writes to Keychain
6. Shell signals raven-core "calendar MCP is now available"
7. raven-core spawns/connects to the calendar MCP server with the
   token
8. Calendar tools become available to voice from that point

Failure modes:
- User declines authorization → graceful "no calendar connector
  configured"
- Token expires → MCP server returns auth error → Aether prompts
  re-auth on next request
- MCP server fails to connect → tool unavailable, surfaces
  "available: false" same as other data sources

## Privacy posture

Authenticated personal data is more sensitive than public data. The
contract for users:

> "Calendar / Email / Drive data is fetched on demand. It's not
> stored locally except in operating memory during a query. The
> only persistent state on your machine is the OAuth refresh token,
> stored in macOS Keychain. Aether never sends your authenticated
> data anywhere except to Gemini Live as part of voice processing
> (the same channel that handles your voice queries today)."

Gemini Live does process the data (Gemini reads the calendar event
when summarizing what's on your day). Worth documenting in the
privacy ADR alongside this roadmap.

Future consideration: local LLM summarization of authenticated data,
with only the summary going to Gemini for voice synthesis. This
would let Aether handle email/calendar without cloud transmission of
the raw content. Out of scope for v1 of the MCP arc; documented as
a future direction.

## Dependency ordering

```
Piece 1 (MCP client substrate) - foundation
        ↓
Piece 2 (Google Calendar) - first real integration
        ↓
Piece 3 (Gmail) ──┐
Piece 4 (Drive) ──┴── parallel to each other; both depend on Piece 2
        ↓
Piece 5 (Digest integration) - depends on at least Pieces 2-4 landing
```

Recommended sequence: 1 → 2 → (3 and 4 in parallel) → 5.

## Composition with voice ambient + vision

The MCP arc layers on top of the existing voice substrate. Once
Piece 1 lands, all subsequent pieces add tools that Gemini Live
sees alongside mesh-backed tools. No special composition required.

The vision arc (gesture wake, pointing) is orthogonal — gesture-
triggered queries can route to MCP-backed tools just as easily as
mesh-backed ones. "Look at this email" pointing at a Mail.app
window could eventually trigger gmail_open(thread_id) via MCP, but
that's far-future.

## NOT in scope for this arc

- Microsoft 365 / Outlook (Google ecosystem first; Microsoft as a
  later parallel arc if Director wants both)
- Apple HealthKit / Apple Notes / iCloud (not exposed via MCP
  today; native bridge would be a separate arc)
- Slack / Discord / chat platforms (different interaction model;
  not part of the personal-OS substrate's first integrations)
- Local file indexing (covered by Drive for cloud files; local
  filesystem search is a separate question)
- Multi-account support (one Google account at a time for v1;
  multi-account is a Settings UX problem)
- MCP server hosting (Aether is an MCP client only; we don't run
  MCP servers)

## Open questions for implementation time

To surface during the relevant PR, not now:

1. **MCP server discovery:** auto-discover via spec, or
   hardcode-known-servers list?
2. **OAuth redirect intercept:** localhost-bound HTTP server in
   shell, or use Electron's protocol handler?
3. **Token storage:** Keychain (proposed), encrypted file, or
   defer-to-MCP-server (it manages its own auth)?
4. **Failure handling:** if MCP server crashes mid-session, retry
   automatically, or surface to user?
5. **Settings app dependency:** how much of the connector UX can
   ship via voice-only ("Aether, connect my calendar") before the
   Settings app exists?

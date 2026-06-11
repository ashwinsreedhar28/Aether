## [2026-06-03] ADR: macos_mail capture is latency-hardened — bulk-read headers, bounded one-per-tick bodies, DB observability

**Status:** accepted
**Decided by:** both (Director directed the debug + per-message/retry-cap/visibility shape; Architect/Director to ratify the specifics surfaced from measurement)
**Context:** The root constraint is **Mail.app's highly variable Apple-Event
latency** — measured sub-second when idle but 30–120s for a *single* property
read when Mail is busy syncing/indexing a large (~5 GB) store. (osascript itself
and other apps stay sub-second; isolated to Mail.) Two failures flowed from
mis-modelling this. (1) The first body implementation read `content of msg` for
all 20 messages inside the header poll; at ~31–45s/message it blew the 30s bridge
timeout and captured nothing, silently. I initially mis-attributed the cost to a
fixed "~28s per-invocation content overhead." (2) The redesign moved bodies out
but kept the original **per-message header loop** (~100 Apple Events: 20 messages
× 5 properties). Under a Mail-latency burst that loop itself timed out at 30s, so
the tick returned before arming and the body phase never even ran — observed live
as a silent `47|0|0` (47 stale rows, 0 bodies, 0 attempts). Both are the
graceful-degrade-masks-systemic-breakage class banked in `docs/governance-log.md`.
**Decision:** Three coupled choices.
1. **Bulk-read the header poll.** Read each property of the whole range in one
   Apple Event (`message id of messages 1 thru 20 of inbox`, then `subject of …`,
   etc.) — ~6 events instead of ~100 — so the poll survives moderate Mail latency
   rather than timing out. Properties are read directly on the range, not via an
   intermediate `set msgList to …` (which hands back message-id-keyed references
   that fail `-1728`); `«class isot»` date coercion runs in a local, event-free
   loop inside the `tell`.
2. **Bounded one-per-tick bodies.** A separate pass fetches **one** `content`
   body per tick (50s budget) for the newest message in a 3-message window
   (`BODY_WINDOW`) still lacking one — newest first, so "read me my latest email"
   fills on the first backfill tick and the window fills over ~3 ticks. A
   per-message `body_attempts` counter (SQLite v3) writes a message off after 3
   failed/empty fetches. One call per message isolates a slow/unreadable message
   from its siblings (the Director's goal), achieved across ticks.
3. **DB-visible observability.** A `mail_meta(key,value)` table records
   `last_header_status`, `last_body_status`, `body_fetch_failures`, last error,
   and timestamps each tick — because the node's stdout is invisible in the
   running shell, so the failure counter alone "a signal nobody can see isn't a
   signal." `last_header_status = timeout` now names a stalled poll at a glance.
**Consequences:** Capture is robust through moderate Mail slowness and degrades
*visibly* (not silently) during severe bursts, self-recovering when Mail responds.
Only the newest ~3 messages carry bodies — enough for "read my latest" + digest;
full-inbox body mirroring stays **foreclosed** at this latency. Five separate
range reads in the header poll admit a sub-millisecond misalignment if mail
arrives mid-poll (one row's fields paired wrong); tolerated by the per-row try and
self-corrected next poll. Establishes the rule: **any Mail AppleScript must
minimise Apple-Event count (bulk reads, never per-element loops) and treat Mail
latency as adversarial** — never batch unbounded `content` reads into a timed
bridge call, and surface poll health where it can be seen.
**Alternatives considered:** (a) Keep the per-message header loop and just raise
the timeout — rejected: 100 events × a latency spike is unbounded; bulk reads fix
the cause. (b) Batch top-3 bodies in one call (~40s when Mail is moderate) —
rejected as default: a single slow message times out the whole batch and loses
all three, the fault-coupling the per-message design avoids. (c) Read Mail's
`Envelope Index` SQLite + `.emlx` files directly (bypass AppleScript entirely,
fast) — deferred as a large redesign; banked as the real long-term fix with an
explicit trigger: **pick this up if Mail.app is still AppleScript-degraded after
~48h of normal use** (i.e. the slowness is chronic on this machine, not the
anomalous burst seen the night this lane shipped — the node captured 47 header
rows via the heavier old path earlier, so Mail normally answers AppleScript
here). (d) On-demand body fetch at the `recent` surface — deferred:
adds latency to the voice call and couples the surface to a running Mail.app.

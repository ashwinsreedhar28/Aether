## [2026-06-03] ADR: mail-body lane expanded to a full vertical (node + tool + prompt)

**Status:** accepted
**Decided by:** both (Director authorized in chat; §14.1 intentional direction change)
**Context:** The mail-body lane was scoped node-only — "`nodes/macos_mail` + its
schema + README + CHANGELOG. NO prompts.json (the richer result needs no prompt
change), NO manifest." Pre-flight reads contradicted that premise on three
points: (1) `prompts.json` hardcodes a worked example telling RAVEN that "read
me my latest email" is a capability gap → `report_gap`, and Gemini Live's
`system_instruction` is fixed at connect, so the gap would still be logged no
matter what the node returns (fails smoke #1 and #3); (2) `mail_tool.py` builds
its `spoken` field from sender + subject only, so a body added to the node
payload would never be read aloud; (3) `mail_tool.py` already sends
`unread_only`, which the surface schema (`additionalProperties: false`,
`limit`/`since` only) rejects — Core validates payloads strictly
(`core/core/core.py`), so `mail_recent` was returning `denied_schema_invalid`
for every call (smoke #2 was already broken). A node-only change therefore could
not meet the lane's own GOAL or smoke tests.
**Decision:** Expand the lane to the full mail vertical with Director approval:
node body capture (schema v2) **plus** `daemons/raven-core/raven_core/tools/mail_tool.py`
(surface the body; speak it on a single-message read) **plus**
`daemons/raven-core/raven_core/prompts/prompts.json` (rewrite the email worked
example into the now-working read-aloud flow). The freed `report_gap` worked
example is **replaced**, not deleted, with a still-true gap ("dim the lights" /
no home-control surface) so the prompt keeps a valid worked example. The
`unread_only` schema mismatch is fixed in-scope as a drive-by (own CHANGELOG
line) since the lane was already editing the schema and node. `manifest.yaml`
was left untouched per the original scope; its prose `description` now slightly
under-describes the surface (omits body) — flagged for a follow-up.
**Consequences:** "Reading the latest email aloud" works end-to-end and the gap
sensor's first capture is closed. Future mail-surface lanes touch a known
three-tier path (node → `mail_tool.py` → `prompts.json`), not just the node.
The voice prompt is now coupled to the mail tool's single-message `spoken`
contract (`limit: 1` ⇒ body in `spoken`). Establishes precedent: a lane scoped
to a node may need to reach into the raven-core tool + prompt tier to actually
land a user-visible capability; the gap-sensor → close-the-gap loop is inherently
cross-tier. `manifest.yaml` description drift is now outstanding.
**Alternatives considered:** (a) Ship node-only and defer the tool+prompt wiring
to a follow-up lane — rejected because the PR would not close the gap it claims
to, and the gap sensor would keep re-recording the same capture (smoke #3 would
fail), making the lane misleading. (b) Pause and have the Architect re-spec —
viable but slower; the Director chose to expand in-flight with the deviation
documented here. (c) Delete the email `report_gap` example outright — rejected
per Director rider (a): it would strip a worked example and risk the model
generalizing report_gap poorly; replacing it with a still-true gap preserves the
teaching value.

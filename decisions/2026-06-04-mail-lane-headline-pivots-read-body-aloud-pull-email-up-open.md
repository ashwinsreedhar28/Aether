## [2026-06-04] ADR: mail lane headline pivots from "read body aloud" to "pull the email up" (open_message actor)

**Status:** accepted (amends the 2026-06-03 "full-vertical" and "latency-hardened
capture" ADRs below — the body-capture machinery they describe stays, but it is
no longer the headline deliverable)
**Decided by:** both (Architect-authorized direction change, §14.1; Director relayed)
**Context:** The body-capture path is correct but unverifiable while Mail.app's
AppleScript interface is degraded (even a 6-event bulk header timed out at 30s
after a restart). Reading a full body aloud is also poor voice UX. Meanwhile,
opening a message in Mail.app via the `message://<rfc-message-id>` URL through
**LaunchServices** (`open` CLI) is a *different code path* from AppleScript and
stays responsive — measured 0.06s the same night AppleScript reads were timing
out at 30–120s. The stored `uid` is already the RFC Message-ID (Mail's `message
id` property), exactly what the `message:` scheme matches, so no new id capture
is needed.
**Decision:** Pivot the lane's headline from "read the body aloud" to "pull the
email up."
1. New **actor surface `macos_mail.open_message {id}`** opens the message via
   `open "message://%3c<id>%3e"` (LaunchServices, deliberately NOT AppleScript).
   `manifest.yaml` declares the surface and the `raven → macos_mail.open_message`
   edge (scope amendment authorized — the original lane said "NO manifest").
2. `mail_tool.mail_open_latest()` + the voice prompt route "read / show / open /
   pull up my latest email" to: speak **ONE line** (sender + subject, plus a
   short gist only if a body was captured) **and** open the message. Full bodies
   are never narrated.
3. **Body capture stays in the node, explicitly non-blocking** — it backfills
   when Mail recovers and feeds the optional one-line gist and future summaries;
   the `mail_meta` diagnostic is unchanged.
**Consequences:** The lane's primary capability is now verifiable independent of
Mail's AppleScript latency (the open path was verified live: `open` exit 0, Mail
frontmost, 0.06s). macos_mail gains an actor surface (the node is now sensor +
actor; category stays Sensor as its primary role). "Read my latest email" no
longer narrates content — it surfaces a one-liner and brings the message up,
which is also better voice UX. Body capture's value shifts from "read aloud" to
"gist + future summaries," so its current `bodies=0` (Mail degraded) no longer
blocks the headline.
**Alternatives considered:** (a) Keep waiting for Mail's AppleScript to recover to
verify read-aloud — rejected: open-via-LaunchServices is both more robust and
better UX. (b) Narrate the body on open — rejected by the Architect: one line +
pull-up, never a wall of spoken body. (c) Drop body capture entirely now that we
don't read it aloud — rejected: it's non-blocking and feeds gists/summaries; kept.

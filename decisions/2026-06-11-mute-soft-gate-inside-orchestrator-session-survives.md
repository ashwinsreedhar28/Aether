## [2026-06-11] ADR: mute is a soft gate inside the orchestrator — the session survives (#219)

**Status:** accepted

**Decided by:** Director (Architect spec on #219), implemented on
`feat/voice-soft-mute`.

**Context:** Mute was implemented as `listenStop` — SIGTERM the Python
child — and unmute as a full respawn (~5s cold start, conversation context
lost). For an ambient assistant that is the wrong primitive: "stop hearing
me" is a privacy gate on the mic, not a request to forget the conversation.
The Director hit both failure modes live: slow unmute, lost context, and a
mute button whose mic icon read as push-to-talk.

**Decision:** Mute becomes a sticky `_muted` flag inside the orchestrator,
alongside (and independent of) the `_playback_until` echo gate. While muted,
mic frames are read and dropped — never forwarded, never replaced with
silence, never fed to the barge-in detector — and the Gemini Live session
stays up. The flag is flipped by a `{"type":"set_muted","muted":bool}` stdin
envelope (the same channel as typed-text envelopes), exposed by the daemon
as `POST /listen/set-muted`, and called by the shell's `voice:set-muted`
IPC. `/listen/stop` is reserved for shutdown. The shell additionally gains
an intentional-stop latch on `ensureAmbientListening` (belt + suspenders:
anything that still stops the child on purpose must not be resurrected by
the ambient re-ensure). The renderer `voiceMuted` flag + broadcast contract
are unchanged.

**Consequences:**
- Unmute is effectively instant (one HTTP hop + one stdin line) and the
  session answers "what did I say before I muted?" — context survives.
- Mute state now lives in two places: the shell's `voiceMuted` flag and the
  orchestrator's `_muted` flag. They can desync if a shell restarts against
  a daemon that kept a muted child alive; surfacing `muted` in `/status` is
  the known follow-up if that bites.
- The stdin channel is now a small control protocol (`text`, `set_muted`),
  not just a text lane; future control messages should ride the same
  envelope shape.
- While muted, typed input still reaches the session by design — mute gates
  the microphone, not the brain.

**Alternatives considered:**
- Keep kill/respawn but make it faster (rejected: any respawn loses session
  context by construction — Gemini Live holds the conversation).
- Pause the PyAudio stream on mute (rejected: keeping the device stream hot
  is what makes unmute instant; reopening risks device races for zero gain).
- Forward silence frames while muted (rejected: spends bandwidth and Gemini
  session time to say nothing; dropping frames is indistinguishable from a
  quiet room server-side).
- Daemon-held mute state with `/status` exposure (deferred: the spec pinned
  the shell's flag + broadcast contract as unchanged; revisit if the
  two-flag desync above is observed in practice).

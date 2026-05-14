# Voice ambient arc roadmap

## Context

Aether's voice today (post-v0.5.0) is button-press style: session-
context aware (PR #25) and aware of articles / tickers / entities,
but still requires explicit user activation. Director's vision is
voice as ambient presence — always ready, polite, conversational.
Jarvis is the closest shorthand: boot greeting on startup, no button
press to talk, idles gracefully when not in use.

This roadmap captures the design for the voice ambient arc as five
pieces, each individually shippable and each compounding with the
prior. The arc is sequential within itself but parallel to the
vision arc (PR #23) — both modify wake/dismiss semantics, both
modify how the user signals attention. They share an orchestrator
state surface (see "Composition with vision arc" below).

## The five pieces

### Piece 1: Boot greeting

When raven-core finishes startup, emit a proactive Gemini turn —
not user-initiated. "Hello, sir" (or time-of-day-aware: "Good
morning, sir" / "Good evening, sir") on the speaker before the user
says anything.

Two implementation paths:

- **Server-mediated (recommended v1):** raven-core's orchestrator
  sends an initial system instruction to Gemini Live ("greet the
  user briefly") on session start, captures the audio response,
  plays it. Greeting can vary; feels alive.
- **Client-mediated fallback:** pre-cached TTS audio file played on
  ready signal. Used if Gemini Live API is unavailable at boot
  (network down, quota exceeded). Static but reliable.

PR shape: `feat/voice-boot-greeting` — small, ~1 PR.

This is the smallest piece and the fastest UX win. Director hears
Aether speak on launch without any input. The product feels
different immediately.

### Piece 2: Always-on mic + local VAD

Microphone opens at app launch and stays open continuously. Audio
streams through a local voice-activity-detection model. Only when
speech is detected does audio forward to Gemini Live.

Library: `silero-vad` (open source, ONNX-based, low CPU, high
accuracy). Alternative `webrtcvad` is lighter but coarser. Recommend
silero-vad — quality difference matters for false-positive control.

Privacy implication: audio passes through the local machine
continuously, but only reaches Gemini when speech is detected. See
"Privacy posture" below for the full contract.

PR shape: `feat/voice-vad-always-on` — ~1-2 PRs (one for the VAD
substrate, possibly a second for mic management and lifecycle).

### Piece 3: Wake word detection

Local wake word ("Aether") detected before activating a Gemini turn.
Without this, every speech segment passing VAD activates Gemini —
too aggressive for ambient use (background conversation, TV audio,
in-room speech to other people would all trigger).

Library options:

- **openWakeWord:** fully open source, customizable, train "Aether"
  as a custom wake word locally. Quality is adequate.
- **pvporcupine (Picovoice):** higher quality, paid for commercial
  use, free for personal projects up to quota. Better false-positive
  rejection but adds external dependency + quota tracking.

Recommendation: `openWakeWord` for v1. Fully open, no quota concerns,
custom-trainable. If false-positive rate proves too aggressive in
practice, pvporcupine is the upgrade path.

PR shape: `feat/voice-wake-word` — ~1-2 PRs (wake word model loading,
detection loop, transition into Gemini activation).

### Piece 4: Idle detection + graceful goodbye

Track conversation activity (last utterance timestamp, last tool
call). After N minutes of silence (default 5 min, configurable in
the future Settings app), transition to a quieter state:

- Speak a graceful idle line: "I'll be here when you need me, sir"
- Stop continuous Gemini Live streaming (close the session)
- VAD continues running locally; wake word listener continues
- Re-activate on next wake word, gesture, or button-press

The transition should feel conversational, not abrupt. Aether
"rests" rather than "quits."

PR shape: `feat/voice-idle-behavior` — ~1 PR.

### Piece 5: Real AEC / barge-in

Once mic is always-on (Piece 2), acoustic echo cancellation becomes
load-bearing. Without proper AEC, Aether's own speech feeds back
into its mic:

1. Aether says "Hello, sir"
2. Mic picks up Aether's voice
3. VAD triggers (speech detected)
4. Gemini transcribes "Hello, sir" as user input
5. Aether responds to its own greeting
6. Loop continues

The current workaround (PR #9, `_playback_until`) closes the mic
during Aether's playback. This works for button-press but breaks
ambient barge-in — user can't interrupt Aether mid-sentence.

Real fix: macOS `voiceProcessingIO` Audio Unit (Apple's built-in
AEC) or software AEC (speex-aec, webrtc-aec3). `voiceProcessingIO`
is the right path on macOS — integrates with system-level echo
cancellation and handles common edge cases.

PR shape: `fix/voice-barge-in-aec` — ~1-2 PRs, the most complex
piece. Likely needs an ADR documenting the chosen AEC subsystem
and the fallback behavior if it fails to initialize.

## Dependency ordering

```
Piece 1 (boot greeting) - independent, ship anytime
        ↓
Piece 2 (always-on mic + VAD) - foundation
        ↓
Piece 3 (wake word) - depends on Piece 2
        ↓
Piece 4 (idle behavior) - depends on Piece 3
        ↓
Piece 5 (AEC) - becomes load-bearing once Piece 2 lands
                (can be deferred but feedback loops will surface)
```

Recommended ship sequence: 1 → 2 → 3 → 4 → 5.

Reasoning: each piece individually shippable and meaningful, but
each makes the next pleasant. Boot greeting alone is the fastest UX
delta. Always-on mic without wake word is too aggressive. Wake word
without idle means voice never rests. Idle behavior without AEC
creates feedback loops during ambient periods.

## Privacy posture

The load-bearing privacy claim is:

> "Audio is processed locally on your machine at all times. Only
> when Aether's wake word is detected does audio reach Gemini for
> further processing. No audio is recorded, logged, or transmitted
> before wake word activation."

This is a real claim. Both VAD (Piece 2) and wake word (Piece 3) run
on-device. Without either, the privacy story degrades materially:

- **Without local VAD:** every sound — TV, conversations, ambient
  noise — streams to Gemini. Expensive and privacy-untenable.
- **Without local wake word:** every speech segment streams to
  Gemini. Better than no VAD but still continuous transcription of
  every conversation in earshot.

Worth a dedicated ADR alongside the Piece 2 PR capturing the privacy
contract — what audio data lives where, what reaches the cloud,
under what conditions. The eventual MCP arc may add Gmail / Calendar
data flowing to Gemini; the contract for "always-listening but local
gates the cloud-touching" is a foundation for that broader story.

## Composition with vision arc

The vision arc roadmap (PR #23) specs a "two-finger peace sign held
for 1-2 seconds" as the wake gesture. This composes with the voice
ambient wake word. Multiple wake mechanisms become available:

- Spoken wake word ("Aether")
- Two-finger wave gesture (when vision-gesture-watcher lands)
- Keyboard shortcut (existing)
- Future: visual gaze direction (deferred to home-substrate vision
  arc)

Each fires the same wake state in raven-core. The orchestrator
should NOT have N independent activation paths. Define a single
voice-wake event type emitted by:

- Wake word detector (this arc, Piece 3)
- Vision gesture watcher (vision arc)
- Keyboard handler (existing)

All routed through the same orchestrator state transition. This is
where voice ambient and vision arcs interlock and should be
architected jointly when both reach implementation.

## Library dependency footprint

New runtime dependencies the full arc will add to raven-core's venv:

- `onnxruntime` (silero-vad runs on ONNX) — or `webrtc-vad-python`
- `openwakeword` (depends on onnxruntime or tflite-runtime)
- Bindings for macOS Audio Unit framework (for voiceProcessingIO) —
  likely via `pyobjc` (already in stack) or `coreaudio` Python
  bindings

All bundled via raven-core's existing `.requirements-installed-v2`
marker pattern from PR #13. No new Electron-side deps.

## NOT in scope (for the arc as a whole)

- Continuous Gemini streaming without VAD/wake word gates
  (cost-prohibitive + privacy-untenable; defeats the whole arc)
- Cloud-based wake word detection (would defeat the privacy posture)
- Multi-user voice differentiation (single-user Aether for now)
- Voice biometric authentication (different problem space)
- Real-time multilingual handling (English-only v1)
- Visual gaze direction as wake cue (deferred to home-substrate
  vision work; not in laptop scope)
- Whisper / local-LLM transcription replacement for Gemini Live
  (Gemini Live is the orchestrator and reasoner; local models are
  for VAD + wake word only)
- User-tunable wake word, idle threshold, or AEC subsystem (needs
  Settings app, which doesn't exist yet)

## Open questions for implementation time

To surface during the relevant PR's spec, not now:

1. **Wake word training (Piece 3):** custom-train "Aether" via
   openWakeWord's training pipeline, or use a default vocabulary
   word as a stopgap until training infrastructure is set up?
2. **Boot greeting context (Piece 1):** time-of-day-aware ("Good
   morning, sir") via system clock, or always-static "Hello, sir"?
   Time-of-day is more pleasant but introduces a small dependency
   on locale / timezone handling.
3. **Idle threshold (Piece 4):** 5 min default, or longer? Should
   the threshold reset on Aether speaking (Aether speech ≠ activity)
   or only on user speech?
4. **AEC failure fallback (Piece 5):** if voiceProcessingIO fails to
   initialize on a given machine (unlikely on modern macOS but
   possible), graceful degradation to existing mic-gating, or hard
   error and disable ambient mode?
5. **VAD aggression (Piece 2):** silero-vad has a threshold
   parameter. Default tuning, or surface to a future Settings app?
   Too sensitive = false positives waste tokens. Too conservative =
   misses quiet speech.

These don't block the roadmap doc. They're flagged here so future
implementation PRs surface them.

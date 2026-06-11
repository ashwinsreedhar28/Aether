## [2026-05-14] Voice ambient arc roadmap: ambient presence in five pieces

**Status:** accepted
**Decided by:** Director (Architect-recommended)
**Context:** The voice path is moving from button-press to ambient
presence — boot greeting, always-on listening with local VAD,
wake-word activation, idle/goodbye behavior, real AEC for barge-in.
Capturing the design before any single voice-ambient PR fires so
implementation PRs reference a shared spec rather than re-deriving
the architecture.

**Decision:** Adopt a five-piece sequence, sequential within the arc,
parallel to the vision arc. Privacy posture is load-bearing: local
VAD + local wake word means no audio reaches Gemini before wake
activation. See `docs/voice-ambient-roadmap.md` for full design
including library choices (silero-vad, openWakeWord,
voiceProcessingIO), dependency ordering, and composition with the
vision arc's gesture-wake.

**Consequences:**
- Each piece (boot greeting, always-on VAD, wake word, idle behavior,
  AEC) ships as its own PR in dependency order — clean UX milestones
  rather than one mega-PR.
- raven-core's venv gains `onnxruntime`, `openwakeword`, and macOS
  Audio Unit bindings when Pieces 2/3/5 land; bundled via the existing
  `.requirements-installed-v2` marker pattern.
- A dedicated privacy-posture ADR is owed alongside the Piece 2 PR
  (always-on mic) that pins what audio lives where and what reaches
  the cloud under which conditions.
- Wake-event routing must be unified across wake word, vision gesture
  (vision arc), and keyboard shortcut. No N-path activation in the
  orchestrator.

**Alternatives considered:**
- Cloud-based wake word (rejected: defeats the privacy posture —
  every speech segment would stream to a cloud detector).
- Continuous Gemini streaming without VAD/wake word gates (rejected:
  cost-prohibitive at ambient duration + privacy-untenable).
- Single-PR implementation of the whole arc (rejected: each piece is
  independently shippable and individually valuable; sequential ship
  gives clean UX milestones and lets Director redirect the arc
  between pieces).
- pvporcupine for Piece 3 wake word (deferred: openWakeWord is fully
  open and avoids quota concerns for v1; pvporcupine remains the
  upgrade path if false-positive rate proves too aggressive).
- Whisper / local-LLM transcription replacement for Gemini Live
  (rejected: Gemini Live is the orchestrator and reasoner; local
  models stay scoped to VAD + wake word).

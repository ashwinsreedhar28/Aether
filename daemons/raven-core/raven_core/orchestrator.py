"""
Orchestrator Module - Main event loop for RAVEN assistant.

Coordinates:
- Audio input/output
- Vision capture
- Gemini Live API communication
- Tool execution
"""

import asyncio
import base64
import json
import time
import traceback
from collections import deque
from typing import Any

import numpy as np
import pyaudio
from google.genai import errors as genai_errors
from google.genai import types
from websockets.exceptions import ConnectionClosed

from .audio import AudioInput, AudioOutput, FORMAT, CHANNELS, SEND_SAMPLE_RATE, RECEIVE_SAMPLE_RATE, CHUNK_SIZE
from .audio_devices import validate_input_device, validate_output_device
from .client import create_client, create_live_config
from .config import Config
from .json_logger import JsonLogger
from . import mesh_client
from .session_context import get_session_context
from .tools import handle_function_call, update_session_context
from .tools.system_tool import set_visual_mode_callback
from .vision import CameraCapture, ScreenCapture

# Live-session drops the reconnect loop in run() treats as recoverable.
# The native-audio preview models have a known, unfixed server-side bug
# (google-gemini/deprecated-generative-ai-js#487; AI Dev Forum #109319):
# the websocket sometimes closes with 1008 "Requested entity was not
# found" right after send_tool_response. ConnectionClosed covers that
# and any transport drop; APIError is the SDK's re-raise of the same
# close; OSError covers network-level failures during connect.
_RECOVERABLE_CLOSE = (ConnectionClosed, genai_errors.APIError, OSError)

# Give up after this many consecutive rapid failures — if sessions keep
# dying immediately, reconnecting is masking a real problem (bad key,
# retired model) and the daemon should surface it instead.
_MAX_RECONNECT_ATTEMPTS = 5

# A session that lived this long before dropping was healthy; reset the
# consecutive-failure counter so one flaky tool call per hour can never
# accumulate into a give-up.
_STABLE_SESSION_S = 30.0

# Barge-in detection (see listen_audio). A mic chunk is CHUNK_SIZE
# frames at SEND_SAMPLE_RATE = 1024/16000 = 64ms, so 3 consecutive
# loud chunks ≈ 190ms of sustained speech — long enough to ignore a
# cough or a dropped object, short enough to feel instant.
_BARGE_IN_CONSECUTIVE_CHUNKS = 3

# EMA weight for the speaker-echo baseline. At 64ms per chunk, 0.25
# settles on a new reply's loudness within ~4 chunks (~250ms) while
# still smoothing over syllable-level dips.
_ECHO_EMA_ALPHA = 0.25


class Orchestrator:
    """
    Main orchestrator for RAVEN voice assistant.

    Manages the event loop coordinating audio I/O, vision capture,
    API communication, and tool execution.
    """

    def __init__(self, config: Config, video_mode: str = "screen"):
        """
        Initialize the orchestrator.

        Args:
            config: RAVEN configuration
            video_mode: Initial video mode ('camera', 'screen', or 'none')
        """
        self.config = config
        self._video_mode = video_mode
        self._pending_mode_change: str | None = None

        # Echo-suppression: when we're playing audio out the speaker, the
        # mac built-in mic picks it up and Gemini Live treats it as user
        # speech — fires interrupted=true (cutting off the current turn)
        # and then responds to the echo. _playback_until is a monotonic
        # timestamp; the listen_audio loop drops mic chunks while
        # time.monotonic() < _playback_until — UNLESS the barge-in
        # detector below decides the user is talking over Raven.
        self._playback_until: float = 0.0

        # User-requested soft mute (see listen_audio). While True, mic
        # frames are read and DROPPED — never forwarded to the API and
        # never replaced with silence — so raven stops hearing without
        # the live session (and its conversation context) being torn
        # down. Sticky: lives on the orchestrator, not the session, so
        # it survives live-session reconnects. Flipped only by the
        # {"type": "set_muted"} stdin envelope (see send_text); the
        # daemon's /listen/stop remains the shutdown path.
        self._muted: bool = False

        # Barge-in detector state (see listen_audio / _is_barge_in).
        # The echo EMA tracks how loud Raven's own voice is at the mic
        # during a playback window; a streak of chunks well above that
        # baseline means the user is speaking over it. The streak's
        # chunks are buffered so the start of the user's utterance
        # reaches the API instead of being eaten by the gate.
        self._echo_rms_ema: float = 0.0
        self._barge_streak: int = 0
        self._barge_buffer: deque[bytes] = deque(
            maxlen=_BARGE_IN_CONSECUTIVE_CHUNKS
        )

        # After a barge-in cut, the server keeps streaming the rest of
        # the old turn's audio until its VAD registers the user's
        # speech. Playing those stragglers would resume Raven's voice
        # and re-close the echo gate mid-utterance — so play_audio
        # discards chunks while this is set. Cleared by receive_audio
        # when the server confirms the interruption (or the turn ends).
        self._suppress_playback: bool = False

        # Queues
        self.audio_in_queue: asyncio.Queue | None = None
        self.out_queue: asyncio.Queue | None = None

        # Session
        self.session = None

        # Latest session-resumption handle from the server (see
        # receive_audio). Carried across websocket lifetimes so the
        # reconnect loop in run() can resume the conversation after a
        # recoverable drop instead of starting cold.
        self._resumption_handle: str | None = None

        # Text-turn readiness. status flips to 'running' the moment the
        # child spawns, but the Gemini live session only accepts input once
        # the server's setup_complete arrives (a few hundred ms later). A
        # text turn injected in that gap is silently dropped — most visibly
        # the boot greeting (verbal ready cue), but also a fast typist
        # racing connect. So we gate injection on _live_ready (set in
        # receive_audio when setup_complete lands) and buffer the last few
        # turns until then. Bounded: a stale boot greeting matters less than
        # unbounded growth if the session never establishes.
        self._live_ready = asyncio.Event()
        self._pending_text: deque[str] = deque(maxlen=3)

        # PyAudio instance
        self._pya: pyaudio.PyAudio | None = None

        # Audio stream references for cleanup. Opened lazily by
        # listen_audio / play_audio and kept open across live-session
        # reconnects — the device streams are independent of the
        # websocket, and reopening them per reconnect risks racing a
        # still-draining PortAudio read from the previous session.
        self._audio_stream = None
        self._playback_stream = None

        # Camera reference for cleanup
        self._camera_cap = None

        # Resolve audio device indices
        self._input_device_index: int | None = None
        self._output_device_index: int | None = None

        if config.audio_input_device is not None:
            try:
                self._input_device_index = validate_input_device(config.audio_input_device)
                print(f"[CONFIG] Using audio input device index: {self._input_device_index}")
            except ValueError as e:
                print(f"[WARNING] {e}, using default input device")

        if config.audio_output_device is not None:
            try:
                self._output_device_index = validate_output_device(config.audio_output_device)
                print(f"[CONFIG] Using audio output device index: {self._output_device_index}")
            except ValueError as e:
                print(f"[WARNING] {e}, using default output device")

        # Register visual mode callback
        set_visual_mode_callback(self._on_visual_mode_change)

    @property
    def video_mode(self) -> str:
        return self._video_mode

    def _on_visual_mode_change(self, mode: str) -> None:
        """Callback when visual mode is changed via tool."""
        if mode != self._video_mode:
            self._pending_mode_change = mode
            if JsonLogger.is_enabled():
                JsonLogger.mode_change(self._video_mode, mode)
            else:
                print(f"[ORCHESTRATOR] Visual mode change requested: {self._video_mode} -> {mode}")

    async def send_text(self) -> None:
        """
        Handle text input on stdin. Two producers share this channel:

        - The Node daemon writes ``q\\n`` to request graceful shutdown
          (ravenManager.stop) and, since the CLI-text lane, a JSON envelope
          ``{"type": "text", "text": ...}\\n`` per typed command
          (ravenManager.sendText). JSON is used so a user typing literally
          "q" — or a multi-line message — is injected as text rather than
          tripping the bare-line shutdown sentinel.
        - Standalone CLI usage (no daemon) still accepts a raw line as the
          message body.

        Either producer's text is injected as a complete user turn via
        ``send_client_content(turn_complete=True)`` so the model responds —
        the SAME live-session entry point a spoken turn reaches. One brain
        for voice and typed input.

        The prompt is suppressed when JSON logging is enabled because
        writing "message > " (no newline) to stdout pollutes every
        subsequent print on the same line — most notably the JSON status
        events emitted by JsonLogger, which then fail JSON.parse on the
        Node daemon side and silently drop status transitions (e.g.
        starting -> running). Discovered in PR #9 live test, where the
        voice-control pill never flipped to "listening".
        """
        prompt = "" if JsonLogger.is_enabled() else "message > "
        while True:
            try:
                line = await asyncio.to_thread(input, prompt)
            except EOFError:
                # stdin closed — the daemon parent went away. Same
                # graceful-shutdown path as a typed "q".
                break
            if line.lower() == "q":
                break
            text = line
            try:
                envelope = json.loads(line)
                if isinstance(envelope, dict) and envelope.get("type") == "set_muted":
                    # Soft-mute control message, not a user turn: flip the
                    # sticky mic gate (listen_audio drops frames while set)
                    # and swallow the line. The live session stays up — that
                    # is the entire point of soft mute.
                    self._muted = bool(envelope.get("muted"))
                    print(
                        f"[ORCHESTRATOR] Soft mute "
                        f"{'engaged — mic frames dropped' if self._muted else 'released — mic frames forwarded'}"
                    )
                    continue
                if isinstance(envelope, dict) and envelope.get("type") == "text":
                    text = str(envelope.get("text", ""))
            except (ValueError, TypeError):
                pass  # not an envelope — treat the raw line as the message
            text = text.strip()
            if not text:
                continue
            # Inject only once the live session can accept input; otherwise
            # buffer (see _live_ready / _pending_text). The is_set() check and
            # the append run with no await between them, so receive_audio's
            # flush can't strand a turn enqueued here.
            if self._live_ready.is_set():
                try:
                    await self._inject_text(text)
                except Exception:
                    # The socket died between the readiness check and the
                    # send (this task outlives individual live sessions).
                    # Buffer the turn; the reconnect path flushes it.
                    self._pending_text.append(text)
            else:
                self._pending_text.append(text)

    async def _inject_text(self, text: str) -> None:
        """Inject one typed turn into the live session as a complete user
        turn so the model responds. Shared by the buffered-flush path and the
        steady-state path in send_text."""
        await self.session.send_client_content(
            turns={"role": "user", "parts": [{"text": text}]},
            turn_complete=True,
        )

    async def send_realtime(self) -> None:
        """Send queued audio/image data to the API."""
        while True:
            msg = await self.out_queue.get()

            if msg.get("mime_type") == "audio/pcm":
                # Send audio data
                await self.session.send_realtime_input(
                    audio=types.Blob(data=msg["data"], mime_type="audio/pcm")
                )
            elif msg.get("mime_type") == "image/jpeg":
                # Send image data
                image_data = base64.b64decode(msg["data"])
                await self.session.send_realtime_input(
                    media=types.Blob(data=image_data, mime_type="image/jpeg")
                )

    async def listen_audio(self) -> None:
        """Capture audio from microphone.

        The mic stream is opened once and reused across live-session
        reconnects (this task is restarted per session, the device
        stream is not — see _audio_stream in __init__).
        """
        if self._audio_stream is None:
            if self._input_device_index is not None:
                mic_info = self._pya.get_device_info_by_index(self._input_device_index)
            else:
                mic_info = self._pya.get_default_input_device_info()
            print(
                f"[AUDIO] Starting microphone capture - Device: {mic_info['name']}, "
                f"Rate: {SEND_SAMPLE_RATE}Hz"
            )

            self._audio_stream = await asyncio.to_thread(
                self._pya.open,
                format=FORMAT,
                channels=CHANNELS,
                rate=SEND_SAMPLE_RATE,
                input=True,
                input_device_index=mic_info["index"],
                frames_per_buffer=CHUNK_SIZE,
            )
            print("[AUDIO] Microphone stream opened successfully")

        kwargs = {"exception_on_overflow": False} if __debug__ else {}
        chunk_count = 0
        muted_count = 0
        soft_mute_dropped = 0

        while True:
            data = await asyncio.to_thread(self._audio_stream.read, CHUNK_SIZE, **kwargs)
            chunk_count += 1
            if chunk_count % 100 == 0:
                print(f"[AUDIO] Captured {chunk_count} audio chunks from microphone")
            # User soft mute: keep reading (the device stream stays hot so
            # unmute is instant) but drop the frame before ANY downstream
            # processing — no forwarding, no silence substitute, and no
            # barge-in detection (a muted mic must never interrupt raven).
            # Checked before the echo gate so the two gates stay independent.
            if self._muted:
                soft_mute_dropped += 1
                if soft_mute_dropped % 100 == 0 and not JsonLogger.is_enabled():
                    print(f"[AUDIO] Soft mute — dropped {soft_mute_dropped} mic chunks")
                continue
            # Echo gate: drop mic chunks while we're playing audio. Without
            # this, the speaker output feeds back into the mic, Gemini Live
            # treats it as user input, generates a response, plays it,
            # picks it up again — the cycling-response failure mode.
            # Exception: sustained mic energy well above the echo
            # baseline means the user is talking OVER Raven — barge-in.
            if time.monotonic() < self._playback_until:
                if not self._is_barge_in(data):
                    muted_count += 1
                    if muted_count % 100 == 0 and not JsonLogger.is_enabled():
                        print(f"[AUDIO] Muted {muted_count} mic chunks during playback")
                    continue
                # Cut local playback now (instant to the ear) and open
                # the gate. The server hears the user's speech and its
                # VAD interrupts generation — receive_audio's
                # interrupted path handles the rest, same as an
                # interruption during silence.
                self._cut_playback_for_barge_in()
                while self._barge_buffer:
                    await self.out_queue.put(
                        {"data": self._barge_buffer.popleft(), "mime_type": "audio/pcm"}
                    )
                continue
            self._reset_barge_in_detector()
            await self.out_queue.put({"data": data, "mime_type": "audio/pcm"})

    def _is_barge_in(self, chunk: bytes) -> bool:
        """Decide whether a playback-window mic chunk is the user
        talking over Raven.

        Energy-gated detection: track an EMA of the mic RMS during
        playback (≈ how loud Raven's own voice is at the mic — the echo
        baseline), and call it user speech when
        _BARGE_IN_CONSECUTIVE_CHUNKS in a row land above
        max(barge_in_min_rms, barge_in_factor × baseline). The EMA is
        only updated from chunks BELOW the threshold so the user's own
        voice can't inflate the baseline it has to beat. This is not
        AEC — the user must speak up over Raven, not whisper — but it
        needs no new deps and no audio-stack rewrite (see issue #239
        for the AEC follow-up).
        """
        if not self.config.barge_in_enabled or not chunk:
            return False
        samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float64)
        rms = float(np.sqrt(np.mean(samples**2)))
        if self._echo_rms_ema == 0.0:
            # First chunk of a playback window seeds the baseline.
            self._echo_rms_ema = rms
            return False
        threshold = max(
            float(self.config.barge_in_min_rms),
            self.config.barge_in_factor * self._echo_rms_ema,
        )
        if rms > threshold:
            self._barge_streak += 1
            self._barge_buffer.append(chunk)
            return self._barge_streak >= _BARGE_IN_CONSECUTIVE_CHUNKS
        self._barge_streak = 0
        self._barge_buffer.clear()
        self._echo_rms_ema = (
            1 - _ECHO_EMA_ALPHA
        ) * self._echo_rms_ema + _ECHO_EMA_ALPHA * rms
        return False

    def _reset_barge_in_detector(self) -> None:
        """Clear detector state once a playback window ends.

        Each reply re-seeds its own echo baseline — replies differ in
        loudness, and a stale baseline from a loud reply would make a
        quiet one impossible to interrupt.
        """
        self._echo_rms_ema = 0.0
        self._barge_streak = 0
        self._barge_buffer.clear()

    def _cut_playback_for_barge_in(self) -> None:
        """Stop Raven's voice locally the moment barge-in is detected.

        Mirrors receive_audio's interrupted path (flush the playback
        queue), zeroes the echo gate so the user's speech streams to
        the API immediately, and raises _suppress_playback so the old
        turn's straggler chunks — the server keeps streaming them until
        its VAD registers the interruption — get discarded instead of
        resuming Raven's voice. The chunk already inside the speaker
        buffer finishes (~64ms tail); the server's interrupted signal
        arrives moments later and stops generation at the source.
        """
        cleared = 0
        if self.audio_in_queue is not None:
            while not self.audio_in_queue.empty():
                self.audio_in_queue.get_nowait()
                cleared += 1
        self._playback_until = 0.0
        self._suppress_playback = True
        if not JsonLogger.is_enabled():
            print(f"[AUDIO] Barge-in — cut playback ({cleared} chunks dropped)")

    async def handle_function_call_async(
        self, function_call: types.FunctionCall
    ) -> dict[str, Any]:
        """
        Handle a function call from the API.

        Args:
            function_call: The function call from Gemini

        Returns:
            Result dictionary. The returned dict carries a
            ``_session_context`` field on top of the tool's own payload;
            see ``session_context.SessionContext.summarize`` for shape.
            This is the per-turn context-injection point — see the
            module-level docstring in raven_core/session_context.py for
            why FunctionResponse augmentation is used instead of a
            (not feasible) live system_instruction update.
        """
        function_name = function_call.name
        function_args = function_call.args or {}
        call_id = function_call.id

        if JsonLogger.is_enabled():
            JsonLogger.function_call(function_name, function_args, call_id)
        else:
            print(f"\n[FUNCTION CALL] {function_name}({json.dumps(function_args)})")

        start_time = time.time()

        try:
            result = await handle_function_call(function_name, function_args)
            duration_ms = int((time.time() - start_time) * 1000)

            if JsonLogger.is_enabled():
                JsonLogger.function_result(function_name, result, duration_ms, call_id)
            else:
                print(f"[FUNCTION RESULT] {json.dumps(result)}")

            # Update SessionContext AFTER the user-visible function-result
            # log so the logged payload remains the tool's raw output.
            # The context update is best-effort: a failure here must not
            # break the tool path (Gemini still gets a valid result),
            # but it should be surfaced so the next debugging session
            # has something to follow.
            try:
                update_session_context(function_name, function_args, result)
            except Exception as ctx_exc:  # pragma: no cover - defensive
                if not JsonLogger.is_enabled():
                    print(
                        f"[SESSION CTX] update failed for {function_name}: {ctx_exc}"
                    )

            return self._augment_with_context(result)
        except Exception as e:
            error_msg = f"Error executing {function_name}: {str(e)}"

            if JsonLogger.is_enabled():
                JsonLogger.function_error(function_name, error_msg, call_id)
            else:
                print(f"[FUNCTION ERROR] {error_msg}")

            return self._augment_with_context({"error": error_msg})

    def _on_user_transcript(self, text: str) -> None:
        """Append a transcribed user utterance to SessionContext.

        Called from ``receive_audio`` when Gemini emits an
        input_transcription event. The transcription stream is
        incremental — Gemini sends one or more fragments per spoken
        burst, and the same logical utterance may arrive in pieces.
        SessionContext.add_utterance drops empty strings and caps
        length, which is enough for our purposes: the deque is a
        best-effort recap, not a verbatim record. Also tee the
        transcript out through JsonLogger so the daemon-side transcript
        view shows what the user said (the existing transcript channel
        only carried Gemini's text replies before).
        """
        ctx = get_session_context()
        ctx.add_utterance(text)
        if JsonLogger.is_enabled():
            JsonLogger.transcript("user", text)

    def _augment_with_context(self, result: Any) -> dict[str, Any]:
        """Attach the SessionContext summary to a tool result.

        Gemini Live's ``system_instruction`` is set once at connect
        time and cannot be hot-swapped per turn (a reconnect would
        interrupt the live audio stream). Attaching the context recap
        to every FunctionResponse is the closest feasible equivalent
        — the recap lands in Gemini's input stream alongside the tool
        payload on every round trip, giving the model fresh state for
        reference-resolution prompts ("the second one", "how about
        last week").
        """
        if not isinstance(result, dict):
            # Defensive: tools currently always return dicts, but if
            # one ever doesn't, wrap it so the FunctionResponse
            # remains well-formed. The original value lives under
            # "result" so the model still sees it.
            base: dict[str, Any] = {"result": result}
        else:
            # Shallow copy: avoid mutating the caller's dict (the same
            # object is passed to JsonLogger above), and we only add
            # one top-level key.
            base = dict(result)
        base["_session_context"] = get_session_context().summarize()
        return base

    async def receive_audio(self) -> None:
        """Process responses from the API."""
        if not JsonLogger.is_enabled():
            print("[AUDIO] Starting audio receiver - waiting for responses from API")
        audio_chunk_count = 0

        while True:
            turn = self.session.receive()
            if not JsonLogger.is_enabled():
                print("[AUDIO] Received turn from API")

            # Track whether this turn was actually interrupted by the user
            # (vs. completing normally). The vendored loop unconditionally
            # drained the playback queue at end-of-turn, which truncated
            # the tail of every normal response — the last few audio
            # chunks were still queued for playback when the turn-complete
            # signal arrived. Only flush on a real interruption.
            interrupted = False

            async for response in turn:
                # The server's setup_complete is the first message after
                # connect and arrives WITHOUT any user turn — the reliable
                # "the live session now accepts input" signal. (Gating on a
                # model response instead would deadlock the boot greeting,
                # whose own injection is what would produce that response.)
                # Flush any turns buffered during the spawn→ready gap.
                if getattr(response, "setup_complete", None) is not None:
                    if not self._live_ready.is_set():
                        self._live_ready.set()
                        while self._pending_text:
                            await self._inject_text(self._pending_text.popleft())
                    continue

                # The server streams periodic resumption handles because
                # session_resumption is enabled in create_live_config.
                # Cache the newest one — it's what lets run()'s reconnect
                # loop resume this conversation after the native-audio
                # models' known post-tool-response 1008 close.
                resumption_update = getattr(
                    response, "session_resumption_update", None
                )
                if resumption_update is not None:
                    if resumption_update.resumable and resumption_update.new_handle:
                        self._resumption_handle = resumption_update.new_handle
                    continue

                # GoAway is the server's advance warning that it will
                # close the connection soon. The reconnect loop handles
                # the actual close; just surface the warning.
                go_away = getattr(response, "go_away", None)
                if go_away is not None:
                    if not JsonLogger.is_enabled():
                        print(
                            f"[SESSION] Server GoAway — closing in {go_away.time_left}"
                        )
                    continue

                # Handle function calls (tool calls)
                if response.tool_call and response.tool_call.function_calls:
                    if not JsonLogger.is_enabled():
                        print(
                            f"\n[TOOL CALL] Received {len(response.tool_call.function_calls)} function call(s)"
                        )
                    function_responses = []

                    for func_call in response.tool_call.function_calls:
                        result = await self.handle_function_call_async(func_call)

                        function_response = types.FunctionResponse(
                            id=func_call.id,
                            name=func_call.name,
                            response=result,
                        )
                        function_responses.append(function_response)

                    if function_responses:
                        await self.session.send_tool_response(
                            function_responses=function_responses
                        )
                        if not JsonLogger.is_enabled():
                            print("[TOOL CALL] Sent function responses back to API")
                    continue

                # Gemini Live signals interruption via
                # response.server_content.interrupted (bool). Use getattr
                # defensively in case the SDK shape shifts.
                server_content = getattr(response, "server_content", None)
                if server_content is not None and getattr(
                    server_content, "interrupted", False
                ):
                    interrupted = True
                    # The server has registered the interruption — the
                    # next audio it sends belongs to the NEW reply, so
                    # stop discarding (see _cut_playback_for_barge_in).
                    self._suppress_playback = False

                # Pull user-side transcripts off the server_content stream.
                # input_audio_transcription is enabled in
                # client.create_live_config, so each user-speech burst
                # produces one or more incremental Transcription events
                # on server_content.input_transcription. Append each
                # non-empty text fragment to the SessionContext so the
                # next FunctionResponse carries the user's actual
                # phrasing in ``_session_context.recent_utterances``.
                # Defensive getattr-chain in case the SDK reshapes the
                # field (it has shifted between v1 and v1beta).
                if server_content is not None:
                    input_transcription = getattr(
                        server_content, "input_transcription", None
                    )
                    if input_transcription is not None:
                        utterance_text = getattr(input_transcription, "text", None)
                        if utterance_text:
                            self._on_user_transcript(utterance_text)

                    # Symmetric to the input side: output_audio_transcription
                    # (client.create_live_config) makes Gemini transcribe its
                    # own spoken reply here. Tee each non-empty fragment onto
                    # the "raven" transcript channel so the CLI can echo what
                    # Aether said. Fragments are incremental (like the input
                    # side); downstream consumers concatenate adjacent
                    # same-speaker fragments into one line.
                    output_transcription = getattr(
                        server_content, "output_transcription", None
                    )
                    if output_transcription is not None:
                        reply_text = getattr(output_transcription, "text", None)
                        if reply_text and JsonLogger.is_enabled():
                            JsonLogger.transcript("raven", reply_text)

                if data := response.data:
                    audio_chunk_count += 1
                    if audio_chunk_count % 50 == 0 and not JsonLogger.is_enabled():
                        print(f"[AUDIO] Received {audio_chunk_count} audio chunks from API")
                    self.audio_in_queue.put_nowait(data)
                    continue

                if text := response.text:
                    if JsonLogger.is_enabled():
                        JsonLogger.transcript("raven", text)
                    else:
                        print(f"\n[API TEXT]: {text}", end="")

            # Only flush the playback queue on a real interruption (so
            # we don't keep speaking over the user). On normal turn
            # completion, leave the buffered chunks alone so play_audio
            # can drain them.
            if interrupted:
                cleared_count = 0
                while not self.audio_in_queue.empty():
                    self.audio_in_queue.get_nowait()
                    cleared_count += 1
                if not JsonLogger.is_enabled():
                    print(f"[AUDIO] Interrupted — cleared {cleared_count} chunks")
            # Turn over — if a barge-in suppression is still pending
            # (false trigger the server never confirmed), lift it so
            # the next reply plays normally.
            self._suppress_playback = False
            audio_chunk_count = 0

    async def play_audio(self) -> None:
        """Play audio from the API.

        Like the mic side, the speaker stream is opened once and reused
        across live-session reconnects.
        """
        if self._playback_stream is None:
            if self._output_device_index is not None:
                speaker_info = self._pya.get_device_info_by_index(self._output_device_index)
                print(f"[AUDIO] Starting audio playback - Device: {speaker_info['name']}, Rate: {RECEIVE_SAMPLE_RATE}Hz")
            else:
                print(f"[AUDIO] Starting audio playback - Rate: {RECEIVE_SAMPLE_RATE}Hz")

            self._playback_stream = await asyncio.to_thread(
                self._pya.open,
                format=FORMAT,
                channels=CHANNELS,
                rate=RECEIVE_SAMPLE_RATE,
                output=True,
                output_device_index=self._output_device_index,
            )
            print("[AUDIO] Audio output stream opened successfully")
        stream = self._playback_stream

        playback_count = 0
        # 300ms grace covers speaker-to-mic acoustic propagation, PortAudio
        # output-buffer latency, and a small margin so playback decay
        # doesn't sneak past the gate.
        ECHO_GRACE_S = 0.3
        bytes_per_sample = 2  # 16-bit PCM
        while True:
            bytestream = await self.audio_in_queue.get()
            # Barge-in suppression: stragglers of an interrupted turn
            # are discarded — playing them would resume Raven's voice
            # and re-close the echo gate over the user's speech.
            if self._suppress_playback:
                continue
            playback_count += 1
            if playback_count % 50 == 0:
                print(f"[AUDIO] Played {playback_count} audio chunks to speakers")
            # Extend the mic-mute window before writing — the chunk is
            # about to hit the speaker, and the gate should already be
            # closed by the time the sound reaches the mic.
            chunk_seconds = len(bytestream) / bytes_per_sample / RECEIVE_SAMPLE_RATE
            self._playback_until = max(
                self._playback_until,
                time.monotonic() + chunk_seconds + ECHO_GRACE_S,
            )
            await asyncio.to_thread(stream.write, bytestream)

    def _get_frame(self, cap) -> dict[str, str] | None:
        """Capture a single camera frame."""
        import cv2
        import PIL.Image
        import io

        ret, frame = cap.read()
        if not ret:
            return None

        # Convert BGR to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = PIL.Image.fromarray(frame_rgb)
        img.thumbnail([1024, 1024])

        image_io = io.BytesIO()
        img.save(image_io, format="jpeg")
        image_io.seek(0)

        return {
            "mime_type": "image/jpeg",
            "data": base64.b64encode(image_io.read()).decode(),
        }

    def _get_screen(self) -> dict[str, str]:
        """Capture a screenshot."""
        import mss
        import PIL.Image
        import io

        sct = mss.mss()
        monitor = sct.monitors[0]
        screenshot = sct.grab(monitor)

        image_bytes = mss.tools.to_png(screenshot.rgb, screenshot.size)
        img = PIL.Image.open(io.BytesIO(image_bytes))

        image_io = io.BytesIO()
        img.save(image_io, format="jpeg")
        image_io.seek(0)

        return {
            "mime_type": "image/jpeg",
            "data": base64.b64encode(image_io.read()).decode(),
        }

    async def vision_capture_loop(self) -> None:
        """
        Dynamic vision capture loop that responds to mode changes.
        Handles switching between camera, screen, and none modes at runtime.
        """
        import cv2

        cap = None

        while True:
            # Check for mode change
            if self._pending_mode_change is not None:
                new_mode = self._pending_mode_change
                self._pending_mode_change = None

                # Clean up old camera if switching away from camera mode
                if self._video_mode == "camera" and cap is not None:
                    cap.release()
                    cap = None
                    self._camera_cap = None
                    print("[VISION] Camera released")

                self._video_mode = new_mode
                print(f"[VISION] Mode switched to: {new_mode}")

                # Initialize camera if switching to camera mode
                if new_mode == "camera":
                    cap = await asyncio.to_thread(cv2.VideoCapture, 0)
                    self._camera_cap = cap
                    if cap.isOpened():
                        print("[VISION] Camera opened successfully")
                    else:
                        print("[VISION] Warning: Failed to open camera")

            # Capture based on current mode
            if self._video_mode == "camera":
                if cap is None or not cap.isOpened():
                    cap = await asyncio.to_thread(cv2.VideoCapture, 0)
                    self._camera_cap = cap
                    if cap.isOpened():
                        print("[VISION] Camera opened successfully")

                if cap is not None and cap.isOpened():
                    frame = await asyncio.to_thread(self._get_frame, cap)
                    if frame is not None:
                        await self.out_queue.put(frame)

            elif self._video_mode == "screen":
                # Release camera if it was open
                if cap is not None:
                    cap.release()
                    cap = None
                    self._camera_cap = None

                frame = await asyncio.to_thread(self._get_screen)
                if frame is not None:
                    await self.out_queue.put(frame)

            # 'none' mode: just sleep, don't capture anything
            # Release camera if switching to none
            elif self._video_mode == "none":
                if cap is not None:
                    cap.release()
                    cap = None
                    self._camera_cap = None

            await asyncio.sleep(1.0)

    async def _run_live_session(self, client, send_text_task) -> None:
        """Run one websocket lifetime against the Live API.

        Connects (resuming the prior conversation when a resumption
        handle is cached), starts the per-session worker tasks, and
        blocks until either the user exits (send_text_task completes →
        raises CancelledError) or a worker fails (the TaskGroup raises
        its ExceptionGroup). The reconnect loop in run() decides whether
        a failure is a recoverable connection drop.
        """
        live_config = create_live_config(self.config, self._resumption_handle)

        async with (
            client.aio.live.connect(
                model=self.config.model, config=live_config
            ) as session,
            asyncio.TaskGroup() as tg,
        ):
            self.session = session
            if JsonLogger.is_enabled():
                JsonLogger.status("connected")
            else:
                print("[INIT] Connected to Gemini API successfully")

            # The SDK completes the setup handshake inside connect() —
            # setup_complete never traverses the receive loop (verified on
            # google-genai 2.2.0 AND 2.8.0), so the receive-loop gate at
            # setup_complete never fired and _live_ready never set: every
            # typed turn buffered forever. Connected IS ready. Set the
            # text-turn gate here; the setup_complete branch in
            # receive_audio stays as a harmless fallback for any SDK
            # version that does surface it.
            self._live_ready.set()
            while self._pending_text:
                await self._inject_text(self._pending_text.popleft())

            # Fresh queues per session: audio buffered for a dead socket
            # is stale on the new one. Barge-in state is likewise
            # per-turn — a suppression pending when the socket died
            # must not mute the new session's first reply.
            self.audio_in_queue = asyncio.Queue()
            self.out_queue = asyncio.Queue(maxsize=5)
            self._suppress_playback = False
            self._reset_barge_in_detector()
            if not JsonLogger.is_enabled():
                print("[INIT] Audio queues initialized")

            if not JsonLogger.is_enabled():
                print("[INIT] Starting all tasks...")
            tg.create_task(self.send_realtime())
            tg.create_task(self.listen_audio())

            # Start unified vision capture loop (handles all modes dynamically)
            if not JsonLogger.is_enabled():
                print(f"[INIT] Starting vision capture (initial mode: {self._video_mode})")
            tg.create_task(self.vision_capture_loop())

            tg.create_task(self.receive_audio())
            tg.create_task(self.play_audio())
            if JsonLogger.is_enabled():
                JsonLogger.status("running", mode=self._video_mode)
            else:
                print("[INIT] All tasks started - RAVEN is running")

            # send_text_task is owned by run() and survives session
            # drops; awaiting it here blocks until user exit, while a
            # worker failure cancels this body and raises the group's
            # ExceptionGroup instead.
            await send_text_task
            raise asyncio.CancelledError("User requested exit")

    async def run(self) -> None:
        """
        Main entry point - run the voice assistant.

        Establishes Gemini connection and coordinates all tasks.
        """
        # Validate configuration
        errors = self.config.validate()
        if errors:
            for error in errors:
                if JsonLogger.is_enabled():
                    JsonLogger.error(error)
                else:
                    print(f"[ERROR] {error}")
            raise ValueError("Configuration validation failed")

        self._pya = pyaudio.PyAudio()

        # Bring up the mesh client BEFORE opening the Gemini Live
        # session so mesh-routed tools (notify) are ready by the time
        # the user can speak. Failure here is non-fatal — setup() logs
        # and returns False; raven-internal tools (time, memory) still
        # work, and notify will surface a structured "mesh unavailable"
        # error to Gemini if invoked.
        await mesh_client.setup()

        try:
            if JsonLogger.is_enabled():
                JsonLogger.status("connecting", model=self.config.model)
            else:
                print(f"[INIT] Connecting to Gemini API - Model: {self.config.model}")

            client = create_client(self.config)

            # The stdin reader lives OUTSIDE the per-connection TaskGroup
            # so a reconnect doesn't spawn a second input() thread — two
            # readers competing for stdin would lose lines (most visibly
            # the daemon's "q" shutdown sentinel).
            send_text_task = asyncio.create_task(self.send_text())

            # Reconnect loop. The native-audio preview models sometimes
            # kill the websocket right after a tool response (1008
            # "Requested entity was not found" — known upstream, no
            # server-side fix). With session_resumption enabled, the drop
            # is recoverable: reconnect with the cached handle and the
            # conversation continues. Non-connection failures re-raise.
            reconnect_attempts = 0
            try:
                while True:
                    session_started = time.monotonic()
                    try:
                        await self._run_live_session(client, send_text_task)
                    except ExceptionGroup as eg:
                        if time.monotonic() - session_started >= _STABLE_SESSION_S:
                            reconnect_attempts = 0
                        recoverable, rest = eg.split(_RECOVERABLE_CLOSE)
                        if rest is not None or reconnect_attempts >= _MAX_RECONNECT_ATTEMPTS:
                            raise
                        reason = "; ".join(
                            f"{type(e).__name__}: {e}"
                            for e in recoverable.exceptions
                        )
                    except _RECOVERABLE_CLOSE as exc:
                        # connect() itself failed, before the TaskGroup
                        # started. With a resumption handle in play the
                        # likeliest cause is the handle going stale —
                        # drop it so the next attempt starts a fresh
                        # session instead of failing forever.
                        if time.monotonic() - session_started >= _STABLE_SESSION_S:
                            reconnect_attempts = 0
                        if reconnect_attempts >= _MAX_RECONNECT_ATTEMPTS:
                            raise
                        reason = f"{type(exc).__name__}: {exc}"
                        self._resumption_handle = None

                    reconnect_attempts += 1
                    self._live_ready.clear()
                    self.session = None

                    # User exited while the session was collapsing — don't
                    # reconnect just to tear straight back down.
                    if send_text_task.done():
                        raise asyncio.CancelledError("User requested exit")

                    delay = min(2 ** (reconnect_attempts - 1), 8)
                    if JsonLogger.is_enabled():
                        JsonLogger.status(
                            "reconnecting",
                            attempt=reconnect_attempts,
                            reason=reason[:200],
                        )
                    else:
                        print(
                            f"[RECONNECT] Live session dropped ({reason}) — "
                            f"reconnecting in {delay}s "
                            f"(attempt {reconnect_attempts}/{_MAX_RECONNECT_ATTEMPTS}, "
                            f"resume handle: {'yes' if self._resumption_handle else 'no'})"
                        )
                    await asyncio.sleep(delay)
            finally:
                if not send_text_task.done():
                    send_text_task.cancel()

        except asyncio.CancelledError:
            if JsonLogger.is_enabled():
                JsonLogger.status("stopping")
            else:
                print("[SHUTDOWN] Shutting down...")
        except Exception as eg:
            # Catches the TaskGroup's ExceptionGroup AND plain connection
            # errors re-raised after the reconnect budget is exhausted —
            # either way the daemon reports and exits cleanly rather than
            # crashing main.py with a raw traceback.
            if self._audio_stream:
                self._audio_stream.close()
            if self._playback_stream:
                self._playback_stream.close()
            if JsonLogger.is_enabled():
                JsonLogger.error(str(eg))
            traceback.print_exception(eg)
        finally:
            # Close the mesh aiohttp session before tearing down audio.
            # Order matters less than completeness — leaking the session
            # would leave a dangling connector in the asyncio runtime
            # warnings on shutdown.
            try:
                await mesh_client.shutdown()
            except Exception as e:
                if not JsonLogger.is_enabled():
                    print(f"[SHUTDOWN] mesh_client.shutdown raised: {e}")
            if self._pya:
                self._pya.terminate()

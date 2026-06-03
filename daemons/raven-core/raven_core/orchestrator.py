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

import pyaudio
from google.genai import types

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
        # time.monotonic() < _playback_until. Trade-off: no barge-in
        # (user can't talk over Raven). Acceptable for week-1; a future
        # PR can replace this with proper AEC or push-to-talk.
        self._playback_until: float = 0.0

        # Queues
        self.audio_in_queue: asyncio.Queue | None = None
        self.out_queue: asyncio.Queue | None = None

        # Session
        self.session = None

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

        # Audio stream reference for cleanup
        self._audio_stream = None

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
            line = await asyncio.to_thread(input, prompt)
            if line.lower() == "q":
                break
            text = line
            try:
                envelope = json.loads(line)
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
                await self._inject_text(text)
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
        """Capture audio from microphone."""
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

        while True:
            data = await asyncio.to_thread(self._audio_stream.read, CHUNK_SIZE, **kwargs)
            chunk_count += 1
            if chunk_count % 100 == 0:
                print(f"[AUDIO] Captured {chunk_count} audio chunks from microphone")
            # Echo gate: drop mic chunks while we're playing audio. Without
            # this, the speaker output feeds back into the mic, Gemini Live
            # treats it as user input, generates a response, plays it,
            # picks it up again — the cycling-response failure mode.
            if time.monotonic() < self._playback_until:
                muted_count += 1
                if muted_count % 100 == 0 and not JsonLogger.is_enabled():
                    print(f"[AUDIO] Muted {muted_count} mic chunks during playback")
                continue
            await self.out_queue.put({"data": data, "mime_type": "audio/pcm"})

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
            audio_chunk_count = 0

    async def play_audio(self) -> None:
        """Play audio from the API."""
        if self._output_device_index is not None:
            speaker_info = self._pya.get_device_info_by_index(self._output_device_index)
            print(f"[AUDIO] Starting audio playback - Device: {speaker_info['name']}, Rate: {RECEIVE_SAMPLE_RATE}Hz")
        else:
            print(f"[AUDIO] Starting audio playback - Rate: {RECEIVE_SAMPLE_RATE}Hz")

        stream = await asyncio.to_thread(
            self._pya.open,
            format=FORMAT,
            channels=CHANNELS,
            rate=RECEIVE_SAMPLE_RATE,
            output=True,
            output_device_index=self._output_device_index,
        )
        print("[AUDIO] Audio output stream opened successfully")

        playback_count = 0
        # 300ms grace covers speaker-to-mic acoustic propagation, PortAudio
        # output-buffer latency, and a small margin so playback decay
        # doesn't sneak past the gate.
        ECHO_GRACE_S = 0.3
        bytes_per_sample = 2  # 16-bit PCM
        while True:
            bytestream = await self.audio_in_queue.get()
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
            live_config = create_live_config(self.config)

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

                self.audio_in_queue = asyncio.Queue()
                self.out_queue = asyncio.Queue(maxsize=5)
                if not JsonLogger.is_enabled():
                    print("[INIT] Audio queues initialized")

                if not JsonLogger.is_enabled():
                    print("[INIT] Starting all tasks...")
                send_text_task = tg.create_task(self.send_text())
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

                await send_text_task
                raise asyncio.CancelledError("User requested exit")

        except asyncio.CancelledError:
            if JsonLogger.is_enabled():
                JsonLogger.status("stopping")
            else:
                print("[SHUTDOWN] Shutting down...")
        except ExceptionGroup as eg:
            if self._audio_stream:
                self._audio_stream.close()
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

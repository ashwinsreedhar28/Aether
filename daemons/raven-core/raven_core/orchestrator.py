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
from typing import Any

import pyaudio
from google.genai import types

from .audio import AudioInput, AudioOutput, FORMAT, CHANNELS, SEND_SAMPLE_RATE, RECEIVE_SAMPLE_RATE, CHUNK_SIZE
from .audio_devices import validate_input_device, validate_output_device
from .client import create_client, create_live_config
from .config import Config
from .json_logger import JsonLogger
from .tools import handle_function_call
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

        # Queues
        self.audio_in_queue: asyncio.Queue | None = None
        self.out_queue: asyncio.Queue | None = None

        # Session
        self.session = None

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
        """Handle text input from console (for testing)."""
        while True:
            text = await asyncio.to_thread(input, "message > ")
            if text.lower() == "q":
                break
            await self.session.send(input=text or ".", end_of_turn=True)

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

        while True:
            data = await asyncio.to_thread(self._audio_stream.read, CHUNK_SIZE, **kwargs)
            chunk_count += 1
            if chunk_count % 100 == 0:
                print(f"[AUDIO] Captured {chunk_count} audio chunks from microphone")
            await self.out_queue.put({"data": data, "mime_type": "audio/pcm"})

    async def handle_function_call_async(
        self, function_call: types.FunctionCall
    ) -> dict[str, Any]:
        """
        Handle a function call from the API.

        Args:
            function_call: The function call from Gemini

        Returns:
            Result dictionary
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
            result = handle_function_call(function_name, function_args)
            duration_ms = int((time.time() - start_time) * 1000)

            if JsonLogger.is_enabled():
                JsonLogger.function_result(function_name, result, duration_ms, call_id)
            else:
                print(f"[FUNCTION RESULT] {json.dumps(result)}")

            return result
        except Exception as e:
            error_msg = f"Error executing {function_name}: {str(e)}"

            if JsonLogger.is_enabled():
                JsonLogger.function_error(function_name, error_msg, call_id)
            else:
                print(f"[FUNCTION ERROR] {error_msg}")

            return {"error": error_msg}

    async def receive_audio(self) -> None:
        """Process responses from the API."""
        if not JsonLogger.is_enabled():
            print("[AUDIO] Starting audio receiver - waiting for responses from API")
        audio_chunk_count = 0

        while True:
            turn = self.session.receive()
            if not JsonLogger.is_enabled():
                print("[AUDIO] Received turn from API")

            async for response in turn:
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
                        if "grounding" in str(response).lower() or hasattr(
                            response, "grounding_metadata"
                        ):
                            print("\n[GROUNDING] Google Search was used")

            # Turn complete - clear audio queue for interruption handling
            if not JsonLogger.is_enabled():
                print("[AUDIO] Turn complete - clearing audio queue")
            cleared_count = 0
            while not self.audio_in_queue.empty():
                self.audio_in_queue.get_nowait()
                cleared_count += 1
            if cleared_count > 0 and not JsonLogger.is_enabled():
                print(f"[AUDIO] Cleared {cleared_count} audio chunks from queue")
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
        while True:
            bytestream = await self.audio_in_queue.get()
            playback_count += 1
            if playback_count % 50 == 0:
                print(f"[AUDIO] Played {playback_count} audio chunks to speakers")
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
            if self._pya:
                self._pya.terminate()

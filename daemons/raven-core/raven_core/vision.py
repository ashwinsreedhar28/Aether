"""
Vision Module - Camera and screen capture.
"""

import asyncio
import base64
import io
from typing import Any

import cv2
import PIL.Image
import mss


class CameraCapture:
    """
    Webcam capture with async queue output.

    Captures frames from the default camera and puts
    base64-encoded JPEG images into an output queue.
    """

    def __init__(self, queue: asyncio.Queue, interval: float = 1.0):
        """
        Initialize camera capture.

        Args:
            queue: Queue to put captured frames
            interval: Seconds between frame captures (default: 1.0)
        """
        self.queue = queue
        self.interval = interval
        self._cap: Any = None
        self._running = False

    async def start(self) -> None:
        """Start camera capture."""
        print("[VISION] Starting camera capture")
        # VideoCapture can block, so run in thread
        self._cap = await asyncio.to_thread(cv2.VideoCapture, 0)
        if not self._cap.isOpened():
            raise RuntimeError("Failed to open camera")
        print("[VISION] Camera opened successfully")
        self._running = True

    def _capture_frame(self) -> dict[str, str] | None:
        """Capture a single frame and encode as base64 JPEG."""
        if not self._cap:
            return None

        ret, frame = self._cap.read()
        if not ret:
            return None

        # Convert BGR to RGB (OpenCV uses BGR, PIL expects RGB)
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = PIL.Image.fromarray(frame_rgb)
        img.thumbnail([1024, 1024])

        # Encode as JPEG
        image_io = io.BytesIO()
        img.save(image_io, format="JPEG")
        image_io.seek(0)
        image_bytes = image_io.read()

        return {
            "mime_type": "image/jpeg",
            "data": base64.b64encode(image_bytes).decode(),
        }

    async def capture_loop(self) -> None:
        """
        Main capture loop - captures frames at interval.
        Must call start() before this.
        """
        if not self._cap:
            raise RuntimeError("CameraCapture not started. Call start() first.")

        frame_count = 0
        while self._running:
            frame = await asyncio.to_thread(self._capture_frame)
            if frame is None:
                print("[VISION] Camera frame capture failed")
                break

            frame_count += 1
            if frame_count % 10 == 0:
                print(f"[VISION] Captured {frame_count} camera frames")

            await self.queue.put(frame)
            await asyncio.sleep(self.interval)

    def stop(self) -> None:
        """Stop camera capture."""
        self._running = False
        if self._cap:
            self._cap.release()
            self._cap = None
            print("[VISION] Camera released")

    def close(self) -> None:
        """Close and cleanup resources."""
        self.stop()


class ScreenCapture:
    """
    Screen capture with async queue output.

    Captures screenshots of the primary monitor and puts
    base64-encoded JPEG images into an output queue.
    """

    def __init__(self, queue: asyncio.Queue, interval: float = 1.0):
        """
        Initialize screen capture.

        Args:
            queue: Queue to put captured screenshots
            interval: Seconds between captures (default: 1.0)
        """
        self.queue = queue
        self.interval = interval
        self._running = False

    def _capture_screen(self) -> dict[str, str]:
        """Capture the screen and encode as base64 JPEG."""
        with mss.mss() as sct:
            # Capture primary monitor
            monitor = sct.monitors[0]
            screenshot = sct.grab(monitor)

            # Convert to PIL Image
            image_bytes = mss.tools.to_png(screenshot.rgb, screenshot.size)
            img = PIL.Image.open(io.BytesIO(image_bytes))

            # Convert to JPEG for smaller size
            image_io = io.BytesIO()
            img.save(image_io, format="JPEG", quality=85)
            image_io.seek(0)
            jpeg_bytes = image_io.read()

            return {
                "mime_type": "image/jpeg",
                "data": base64.b64encode(jpeg_bytes).decode(),
            }

    async def capture_loop(self) -> None:
        """Main capture loop - captures screenshots at interval."""
        self._running = True
        print("[VISION] Starting screen capture")
        frame_count = 0

        while self._running:
            frame = await asyncio.to_thread(self._capture_screen)
            if frame is None:
                print("[VISION] Screen capture failed")
                break

            frame_count += 1
            if frame_count % 10 == 0:
                print(f"[VISION] Captured {frame_count} screen frames")

            await self.queue.put(frame)
            await asyncio.sleep(self.interval)

    def stop(self) -> None:
        """Stop screen capture."""
        self._running = False
        print("[VISION] Screen capture stopped")

    def close(self) -> None:
        """Close and cleanup resources."""
        self.stop()


class VisionManager:
    """
    Manager for switching between camera and screen capture.

    Allows runtime switching of visual input mode.
    """

    def __init__(self, queue: asyncio.Queue, initial_mode: str = "none"):
        """
        Initialize vision manager.

        Args:
            queue: Queue to put captured frames
            initial_mode: Initial mode ('camera', 'screen', or 'none')
        """
        self.queue = queue
        self._mode = initial_mode
        self._camera: CameraCapture | None = None
        self._screen: ScreenCapture | None = None
        self._current_task: asyncio.Task | None = None

    @property
    def mode(self) -> str:
        """Current visual mode."""
        return self._mode

    async def set_mode(self, mode: str) -> None:
        """
        Set the visual capture mode.

        Args:
            mode: 'camera', 'screen', or 'none'
        """
        if mode == self._mode:
            return

        # Stop current capture
        await self.stop()

        self._mode = mode

        if mode == "camera":
            self._camera = CameraCapture(self.queue)
            await self._camera.start()
            self._current_task = asyncio.create_task(self._camera.capture_loop())
        elif mode == "screen":
            self._screen = ScreenCapture(self.queue)
            self._current_task = asyncio.create_task(self._screen.capture_loop())
        # 'none' means no capture

        print(f"[VISION] Mode set to: {mode}")

    async def start(self) -> None:
        """Start capture with current mode."""
        await self.set_mode(self._mode)

    async def stop(self) -> None:
        """Stop any active capture."""
        if self._current_task:
            self._current_task.cancel()
            try:
                await self._current_task
            except asyncio.CancelledError:
                pass
            self._current_task = None

        if self._camera:
            self._camera.close()
            self._camera = None
        if self._screen:
            self._screen.close()
            self._screen = None

    def close(self) -> None:
        """Close and cleanup all resources."""
        if self._camera:
            self._camera.close()
        if self._screen:
            self._screen.close()

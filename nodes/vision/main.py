#!/usr/bin/env python3
"""
Vision capture node for Aether.

Provides real-time camera frame capture via AVFoundation on macOS.
Implements 10fps capture with 5-second idle timeout for battery efficiency.

Surface: vision.frame()
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import sys
import time
from typing import Any

# Add core SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../core"))

from node_sdk import MeshNode, MeshDeny

# macOS AVFoundation imports
try:
    import objc
    from AVFoundation import (
        AVCaptureDevice,
        AVCaptureDeviceInput,
        AVCaptureSession,
        AVCaptureVideoDataOutput,
        AVMediaTypeVideo,
    )
    from CoreMedia import CMSampleBufferGetImageBuffer
    from CoreVideo import (
        CVPixelBufferLockBaseAddress,
        CVPixelBufferUnlockBaseAddress,
        CVPixelBufferGetBaseAddress,
        CVPixelBufferGetBytesPerRow,
        CVPixelBufferGetWidth,
        CVPixelBufferGetHeight,
        kCVPixelBufferLock_ReadOnly,
    )
    from Foundation import NSObject
    from Cocoa import NSImage, NSBitmapImageRep
    AVFOUNDATION_AVAILABLE = True
except ImportError:
    AVFOUNDATION_AVAILABLE = False

from PIL import Image

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("vision")


class CameraCapture:
    """Manages camera lifecycle with idle timeout."""

    IDLE_TIMEOUT_SEC = 5.0
    TARGET_FPS = 10
    FRAME_INTERVAL_MS = 100  # 1000ms / 10fps
    JPEG_QUALITY = 80

    def __init__(self):
        self.session: AVCaptureSession | None = None
        self.device: AVCaptureDevice | None = None
        self.last_frame: dict[str, Any] | None = None
        self.last_access_time: float = 0.0
        self.warmup_complete: bool = False
        self._delegate: CaptureDelegate | None = None
        self._lock = asyncio.Lock()
        self._idle_task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start the camera capture session."""
        if not AVFOUNDATION_AVAILABLE:
            log.error("AVFoundation not available (non-macOS platform)")
            return

        async with self._lock:
            if self.session is not None:
                log.info("Camera already active")
                return

            log.info("Starting camera session")
            self.warmup_complete = False

            # Get default video device
            self.device = AVCaptureDevice.defaultDeviceWithMediaType_(AVMediaTypeVideo)
            if self.device is None:
                log.error("No camera device found")
                return

            # Create capture session
            self.session = AVCaptureSession.alloc().init()
            self.session.setSessionPreset_("AVCaptureSessionPreset1280x720")

            # Add device input
            error = None
            device_input = AVCaptureDeviceInput.deviceInputWithDevice_error_(
                self.device, objc.nil
            )
            if device_input is None or not self.session.canAddInput_(device_input):
                log.error("Cannot add camera input")
                self.session = None
                self.device = None
                return

            self.session.addInput_(device_input)

            # Add video output
            video_output = AVCaptureVideoDataOutput.alloc().init()

            # Create delegate to receive frames
            self._delegate = CaptureDelegate.alloc().init()
            self._delegate.set_callback(self._on_frame_captured)

            # Set up output queue
            from dispatch import dispatch_queue_create, DISPATCH_QUEUE_SERIAL
            queue = dispatch_queue_create(b"com.aether.vision.capture", DISPATCH_QUEUE_SERIAL)
            video_output.setSampleBufferDelegate_queue_(self._delegate, queue)

            if self.session.canAddOutput_(video_output):
                self.session.addOutput_(video_output)
            else:
                log.error("Cannot add video output")
                self.session = None
                self.device = None
                return

            # Start the session
            self.session.startRunning()

            # Mark last access
            self.last_access_time = time.time()

            # Start idle timeout task
            if self._idle_task is None or self._idle_task.done():
                self._idle_task = asyncio.create_task(self._idle_monitor())

            log.info("Camera session started")

            # Wait for first frame (warmup)
            await asyncio.sleep(0.2)
            self.warmup_complete = True

    async def stop(self) -> None:
        """Stop the camera capture session."""
        async with self._lock:
            if self.session is None:
                return

            log.info("Stopping camera session")

            if self._idle_task and not self._idle_task.done():
                self._idle_task.cancel()
                try:
                    await self._idle_task
                except asyncio.CancelledError:
                    pass

            self.session.stopRunning()
            self.session = None
            self.device = None
            self.last_frame = None
            self.warmup_complete = False
            self._delegate = None

            log.info("Camera session stopped")

    def _on_frame_captured(self, sample_buffer) -> None:
        """Callback invoked by AVFoundation when a frame is captured."""
        try:
            # Extract pixel buffer from sample buffer
            pixel_buffer = CMSampleBufferGetImageBuffer(sample_buffer)
            if pixel_buffer is None:
                return

            # Lock the pixel buffer
            CVPixelBufferLockBaseAddress(pixel_buffer, kCVPixelBufferLock_ReadOnly)

            try:
                # Get buffer properties
                width = CVPixelBufferGetWidth(pixel_buffer)
                height = CVPixelBufferGetHeight(pixel_buffer)
                bytes_per_row = CVPixelBufferGetBytesPerRow(pixel_buffer)
                base_address = CVPixelBufferGetBaseAddress(pixel_buffer)

                # Convert to PIL Image
                # Assuming BGRA format (common for macOS)
                import ctypes
                buffer_size = bytes_per_row * height
                buffer_data = ctypes.string_at(base_address, buffer_size)

                # Create PIL Image from raw buffer
                img = Image.frombytes('RGBA', (width, height), buffer_data, 'raw', 'BGRA')

                # Convert to RGB
                img_rgb = img.convert('RGB')

                # Encode to JPEG
                jpeg_buffer = io.BytesIO()
                img_rgb.save(jpeg_buffer, format='JPEG', quality=self.JPEG_QUALITY)
                jpeg_bytes = jpeg_buffer.getvalue()

                # Base64 encode
                frame_b64 = base64.b64encode(jpeg_bytes).decode('ascii')

                # Store frame data
                self.last_frame = {
                    "available": True,
                    "frame_b64": frame_b64,
                    "format": "jpeg",
                    "quality": self.JPEG_QUALITY,
                    "width": width,
                    "height": height,
                    "timestamp": int(time.time() * 1000),
                }

            finally:
                CVPixelBufferUnlockBaseAddress(pixel_buffer, kCVPixelBufferLock_ReadOnly)

        except Exception as e:
            log.error(f"Error capturing frame: {e}", exc_info=True)

    async def get_frame(self) -> dict[str, Any]:
        """Get the most recent frame, starting camera if needed."""
        self.last_access_time = time.time()

        if self.session is None:
            await self.start()

        if not self.warmup_complete:
            return {
                "available": False,
                "reason": "warming_up",
            }

        if self.last_frame is None:
            return {
                "available": False,
                "reason": "warming_up",
            }

        return self.last_frame.copy()

    async def _idle_monitor(self) -> None:
        """Background task that releases camera after idle timeout."""
        while True:
            try:
                await asyncio.sleep(1.0)

                if self.session is not None:
                    elapsed = time.time() - self.last_access_time
                    if elapsed >= self.IDLE_TIMEOUT_SEC:
                        log.info(f"Idle timeout ({self.IDLE_TIMEOUT_SEC}s) reached, releasing camera")
                        await self.stop()

            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error(f"Error in idle monitor: {e}", exc_info=True)


class CaptureDelegate(NSObject):
    """Objective-C delegate to receive video frames."""

    def init(self):
        self = objc.super(CaptureDelegate, self).init()
        if self is None:
            return None
        self.callback = None
        return self

    def set_callback(self, callback):
        """Set the Python callback to invoke on frame capture."""
        self.callback = callback

    def captureOutput_didOutputSampleBuffer_fromConnection_(
        self, output, sample_buffer, connection
    ):
        """AVCaptureVideoDataOutputSampleBufferDelegate method."""
        if self.callback:
            self.callback(sample_buffer)


# Global camera instance
camera = CameraCapture()


async def handle_frame(params: dict) -> dict[str, Any]:
    """Handler for vision.frame() surface."""
    try:
        frame = await camera.get_frame()
        return frame
    except Exception as e:
        log.error(f"Error in handle_frame: {e}", exc_info=True)
        raise MeshDeny(
            reason="internal_error",
            message=str(e),
        )


async def main() -> int:
    """Entry point for vision node."""
    # Check platform
    if not AVFOUNDATION_AVAILABLE:
        log.error("AVFoundation not available - vision node requires macOS")
        return 1

    # Get config from environment
    node_id = os.getenv("NODE_ID", "vision")
    secret = os.getenv("VISION_SECRET")
    core_url = os.getenv("CORE_URL", "http://127.0.0.1:8000")

    if not secret:
        log.error("VISION_SECRET environment variable required")
        return 1

    # Create mesh node
    node = MeshNode(
        node_id=node_id,
        secret=secret,
        core_url=core_url,
    )

    # Register surface handler
    node.on("frame", handle_frame)

    log.info(f"Vision node starting (node_id={node_id}, core_url={core_url})")

    try:
        await node.start()

        # Run until interrupted
        while True:
            await asyncio.sleep(1)

    except KeyboardInterrupt:
        log.info("Shutting down...")
    finally:
        await camera.stop()
        await node.stop()

    return 0


if __name__ == "__main__":
    try:
        exit_code = asyncio.run(main())
        sys.exit(exit_code)
    except KeyboardInterrupt:
        sys.exit(0)

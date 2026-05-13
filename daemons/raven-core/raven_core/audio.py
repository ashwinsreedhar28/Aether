"""
Audio I/O Module - Microphone capture and speaker playback.
"""

import asyncio
from typing import Any

import pyaudio

# Audio format constants
FORMAT = pyaudio.paInt16
CHANNELS = 1
SEND_SAMPLE_RATE = 16000  # Rate for sending to API
RECEIVE_SAMPLE_RATE = 24000  # Rate for receiving from API
CHUNK_SIZE = 1024


class AudioInput:
    """
    Microphone capture with async queue output.

    Captures audio from the default input device and
    puts chunks into an output queue as PCM data.
    """

    def __init__(self, queue: asyncio.Queue, pyaudio_instance: pyaudio.PyAudio | None = None):
        """
        Initialize audio input.

        Args:
            queue: Queue to put captured audio chunks
            pyaudio_instance: Optional PyAudio instance (creates one if not provided)
        """
        self.queue = queue
        self._pya = pyaudio_instance or pyaudio.PyAudio()
        self._owns_pya = pyaudio_instance is None
        self._stream: Any = None
        self._running = False

    async def start(self) -> None:
        """Start capturing audio from the microphone."""
        mic_info = self._pya.get_default_input_device_info()
        print(
            f"[AUDIO] Starting microphone capture - Device: {mic_info['name']}, "
            f"Rate: {SEND_SAMPLE_RATE}Hz"
        )

        self._stream = await asyncio.to_thread(
            self._pya.open,
            format=FORMAT,
            channels=CHANNELS,
            rate=SEND_SAMPLE_RATE,
            input=True,
            input_device_index=mic_info["index"],
            frames_per_buffer=CHUNK_SIZE,
        )
        print("[AUDIO] Microphone stream opened successfully")
        self._running = True

    async def capture_loop(self) -> None:
        """
        Main capture loop - reads audio and puts to queue.
        Must call start() before this.
        """
        if not self._stream:
            raise RuntimeError("AudioInput not started. Call start() first.")

        kwargs = {"exception_on_overflow": False} if __debug__ else {}
        chunk_count = 0

        while self._running:
            data = await asyncio.to_thread(self._stream.read, CHUNK_SIZE, **kwargs)
            chunk_count += 1
            if chunk_count % 100 == 0:
                print(f"[AUDIO] Captured {chunk_count} audio chunks from microphone")
            await self.queue.put({"data": data, "mime_type": "audio/pcm"})

    def stop(self) -> None:
        """Stop capturing audio."""
        self._running = False
        if self._stream:
            self._stream.close()
            self._stream = None

    def close(self) -> None:
        """Close and cleanup resources."""
        self.stop()
        if self._owns_pya and self._pya:
            self._pya.terminate()
            self._pya = None


class AudioOutput:
    """
    Speaker playback from async queue.

    Reads PCM audio chunks from a queue and plays them
    through the default output device.
    """

    def __init__(self, queue: asyncio.Queue, pyaudio_instance: pyaudio.PyAudio | None = None):
        """
        Initialize audio output.

        Args:
            queue: Queue to read audio chunks from
            pyaudio_instance: Optional PyAudio instance (creates one if not provided)
        """
        self.queue = queue
        self._pya = pyaudio_instance or pyaudio.PyAudio()
        self._owns_pya = pyaudio_instance is None
        self._stream: Any = None
        self._running = False

    async def start(self) -> None:
        """Start the audio output stream."""
        print(f"[AUDIO] Starting audio playback - Rate: {RECEIVE_SAMPLE_RATE}Hz")
        self._stream = await asyncio.to_thread(
            self._pya.open,
            format=FORMAT,
            channels=CHANNELS,
            rate=RECEIVE_SAMPLE_RATE,
            output=True,
        )
        print("[AUDIO] Audio output stream opened successfully")
        self._running = True

    async def playback_loop(self) -> None:
        """
        Main playback loop - reads from queue and plays audio.
        Must call start() before this.
        """
        if not self._stream:
            raise RuntimeError("AudioOutput not started. Call start() first.")

        playback_count = 0

        while self._running:
            bytestream = await self.queue.get()
            playback_count += 1
            if playback_count % 50 == 0:
                print(f"[AUDIO] Played {playback_count} audio chunks to speakers")
            await asyncio.to_thread(self._stream.write, bytestream)

    def stop(self) -> None:
        """Stop audio playback."""
        self._running = False
        if self._stream:
            self._stream.close()
            self._stream = None

    def close(self) -> None:
        """Close and cleanup resources."""
        self.stop()
        if self._owns_pya and self._pya:
            self._pya.terminate()
            self._pya = None

    def clear_queue(self) -> int:
        """
        Clear the audio queue (for interruption handling).

        Returns:
            Number of items cleared
        """
        cleared = 0
        while not self.queue.empty():
            try:
                self.queue.get_nowait()
                cleared += 1
            except asyncio.QueueEmpty:
                break
        return cleared


def create_audio_io(
    out_queue: asyncio.Queue,
    in_queue: asyncio.Queue,
) -> tuple[AudioInput, AudioOutput, pyaudio.PyAudio]:
    """
    Create audio input and output with shared PyAudio instance.

    Args:
        out_queue: Queue for outgoing audio (to API)
        in_queue: Queue for incoming audio (from API)

    Returns:
        Tuple of (AudioInput, AudioOutput, PyAudio instance)
    """
    pya = pyaudio.PyAudio()
    audio_in = AudioInput(out_queue, pya)
    audio_out = AudioOutput(in_queue, pya)
    return audio_in, audio_out, pya

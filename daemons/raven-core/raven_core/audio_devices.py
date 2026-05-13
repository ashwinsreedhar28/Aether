"""
Audio Device Utilities - Enumerate and validate audio devices.

Provides functions to list available input/output devices and
validate device selections by index or name.
"""

from dataclasses import dataclass
from typing import Optional

import pyaudio


@dataclass
class AudioDevice:
    """Represents an audio device."""
    index: int
    name: str
    max_input_channels: int
    max_output_channels: int
    default_sample_rate: float
    is_input: bool
    is_output: bool


def get_audio_devices(pya: pyaudio.PyAudio | None = None) -> list[AudioDevice]:
    """
    Enumerate all available audio devices.

    Args:
        pya: Optional PyAudio instance (creates one if not provided)

    Returns:
        List of AudioDevice objects
    """
    owns_pya = pya is None
    if owns_pya:
        pya = pyaudio.PyAudio()

    try:
        devices = []
        for i in range(pya.get_device_count()):
            info = pya.get_device_info_by_index(i)
            devices.append(AudioDevice(
                index=i,
                name=info['name'],
                max_input_channels=info['maxInputChannels'],
                max_output_channels=info['maxOutputChannels'],
                default_sample_rate=info['defaultSampleRate'],
                is_input=info['maxInputChannels'] > 0,
                is_output=info['maxOutputChannels'] > 0,
            ))
        return devices
    finally:
        if owns_pya:
            pya.terminate()


def get_input_devices(pya: pyaudio.PyAudio | None = None) -> list[AudioDevice]:
    """Get only input devices (microphones)."""
    return [d for d in get_audio_devices(pya) if d.is_input]


def get_output_devices(pya: pyaudio.PyAudio | None = None) -> list[AudioDevice]:
    """Get only output devices (speakers)."""
    return [d for d in get_audio_devices(pya) if d.is_output]


def find_device_by_name(
    name: str,
    devices: list[AudioDevice]
) -> Optional[AudioDevice]:
    """Find a device by name (case-insensitive partial match)."""
    name_lower = name.lower()
    for device in devices:
        if name_lower in device.name.lower():
            return device
    return None


def find_device_by_index(
    index: int,
    devices: list[AudioDevice]
) -> Optional[AudioDevice]:
    """Find a device by index."""
    for device in devices:
        if device.index == index:
            return device
    return None


def validate_input_device(device_id: int | str | None) -> Optional[int]:
    """
    Validate an input device specification.

    Args:
        device_id: Device index (int) or name (str), or None for default

    Returns:
        Valid device index or None for default

    Raises:
        ValueError: If device not found or not an input device
    """
    if device_id is None:
        return None

    devices = get_input_devices()

    if isinstance(device_id, int):
        device = find_device_by_index(device_id, devices)
        if device:
            return device.index
        raise ValueError(f"No input device found with index {device_id}")

    # String: search by name
    device = find_device_by_name(device_id, devices)
    if device:
        return device.index
    raise ValueError(f"No input device found matching '{device_id}'")


def validate_output_device(device_id: int | str | None) -> Optional[int]:
    """
    Validate an output device specification.

    Args:
        device_id: Device index (int) or name (str), or None for default

    Returns:
        Valid device index or None for default

    Raises:
        ValueError: If device not found or not an output device
    """
    if device_id is None:
        return None

    devices = get_output_devices()

    if isinstance(device_id, int):
        device = find_device_by_index(device_id, devices)
        if device:
            return device.index
        raise ValueError(f"No output device found with index {device_id}")

    device = find_device_by_name(device_id, devices)
    if device:
        return device.index
    raise ValueError(f"No output device found matching '{device_id}'")


def list_devices_formatted() -> str:
    """
    Get a formatted string listing all audio devices.

    Returns:
        Formatted string with input and output devices listed
    """
    lines = []

    lines.append("\n=== Input Devices (Microphones) ===")
    for device in get_input_devices():
        lines.append(f"  [{device.index}] {device.name}")

    lines.append("\n=== Output Devices (Speakers) ===")
    for device in get_output_devices():
        lines.append(f"  [{device.index}] {device.name}")

    lines.append("")
    return "\n".join(lines)

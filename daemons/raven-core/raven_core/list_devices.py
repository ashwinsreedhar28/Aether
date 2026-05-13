#!/usr/bin/env python3
"""
Output audio devices as JSON for daemon consumption.

This script is called by the raven-daemon to enumerate available
audio input and output devices without shell escaping issues.
"""

import json
import pyaudio


def main():
    """List all audio devices and output as JSON."""
    p = pyaudio.PyAudio()
    devices = {"input": [], "output": []}

    for i in range(p.get_device_count()):
        info = p.get_device_info_by_index(i)
        device = {
            "index": i,
            "name": info["name"],
            "isInput": info["maxInputChannels"] > 0,
            "isOutput": info["maxOutputChannels"] > 0
        }
        if device["isInput"]:
            devices["input"].append(device)
        if device["isOutput"]:
            devices["output"].append(device)

    p.terminate()
    print(json.dumps(devices))


if __name__ == "__main__":
    main()

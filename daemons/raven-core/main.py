#!/usr/bin/env python3
"""
RAVEN - Rather Intelligent Virtual Environment Nexus

A modular AI voice assistant built on Gemini Live API.

Usage:
    python main.py [--mode camera|screen|none]

Examples:
    python main.py                    # Default: screen capture mode
    python main.py --mode camera      # Use webcam
    python main.py --mode none        # Voice only, no visual input
"""

import argparse
import asyncio
import sys

from raven_core.audio_devices import list_devices_formatted
from raven_core.config import Config
from raven_core.orchestrator import Orchestrator
from raven_core.json_logger import JsonLogger


def main() -> int:
    """Main entry point for RAVEN."""
    parser = argparse.ArgumentParser(
        description="RAVEN - Rather Intelligent Virtual Environment Nexus",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                                Run with screen capture (default)
  %(prog)s --mode camera                  Run with webcam input
  %(prog)s --mode none                    Voice only, no visual input
  %(prog)s --list-devices                 List available audio devices
  %(prog)s --audio-input 2                Use input device at index 2
  %(prog)s --audio-output "MacBook"       Use output device matching "MacBook"

Environment Variables:
  GEMINI_API_KEY    Required. Your Gemini API key.

Configuration:
  ~/.raven/prompts.json    Custom system prompts (overrides defaults)
  ~/.raven/config.json     App whitelist, audio devices, and settings
  ~/.raven/notes.json      Persistent memory storage
        """,
    )

    parser.add_argument(
        "--mode",
        type=str,
        default="screen",
        choices=["camera", "screen", "none"],
        help="Visual input mode (default: screen)",
    )

    parser.add_argument(
        "--version",
        action="version",
        version="RAVEN 0.1.0",
    )

    parser.add_argument(
        "--json-output",
        action="store_true",
        help="Output structured JSON logs for daemon integration",
    )

    parser.add_argument(
        "--audio-input",
        type=str,
        default=None,
        help="Audio input device (name or index). Use --list-devices to see available devices.",
    )

    parser.add_argument(
        "--audio-output",
        type=str,
        default=None,
        help="Audio output device (name or index). Use --list-devices to see available devices.",
    )

    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="List available audio devices and exit",
    )

    args = parser.parse_args()

    # Handle --list-devices
    if args.list_devices:
        print(list_devices_formatted())
        return 0

    # Enable JSON logging if requested
    if args.json_output:
        JsonLogger.enable()

    # ASCII art banner (skip in JSON mode)
    if not args.json_output:
        print(
            """
    ██████╗  █████╗ ██╗   ██╗███████╗███╗   ██╗
    ██╔══██╗██╔══██╗██║   ██║██╔════╝████╗  ██║
    ██████╔╝███████║██║   ██║█████╗  ██╔██╗ ██║
    ██╔══██╗██╔══██║╚██╗ ██╔╝██╔══╝  ██║╚██╗██║
    ██║  ██║██║  ██║ ╚████╔╝ ███████╗██║ ╚████║
    ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═══╝
    Rather Intelligent Virtual Environment Nexus
    """
        )

    if args.json_output:
        JsonLogger.status("loading_config")
    else:
        print(f"[INIT] Loading configuration...")

    # Load configuration
    config = Config.load()

    # Override config with CLI args if provided
    if args.audio_input is not None:
        try:
            config.audio_input_device = int(args.audio_input)
        except ValueError:
            config.audio_input_device = args.audio_input

    if args.audio_output is not None:
        try:
            config.audio_output_device = int(args.audio_output)
        except ValueError:
            config.audio_output_device = args.audio_output

    # Validate configuration
    errors = config.validate()
    if errors:
        if args.json_output:
            JsonLogger.error("Configuration validation failed", errors=errors)
        else:
            print("\n[ERROR] Configuration errors:")
            for error in errors:
                print(f"  - {error}")
            print("\nPlease set the GEMINI_API_KEY environment variable:")
            print("  export GEMINI_API_KEY='your-api-key'")
        return 1

    # Ensure user directory exists
    config.ensure_user_dir()

    if args.json_output:
        JsonLogger.status(
            "initialized",
            mode=args.mode,
            model=config.model,
            voice=config.voice_name
        )
    else:
        print(f"[INIT] Mode: {args.mode}")
        print(f"[INIT] Model: {config.model}")
        print(f"[INIT] Voice: {config.voice_name}")
        print()
        print("Type 'q' and press Enter to quit.")
        print("-" * 50)

    # Create and run orchestrator
    orchestrator = Orchestrator(config, video_mode=args.mode)

    try:
        asyncio.run(orchestrator.run())
    except KeyboardInterrupt:
        if args.json_output:
            JsonLogger.status("interrupted")
        else:
            print("\n[SHUTDOWN] Interrupted by user")

    if args.json_output:
        JsonLogger.status("stopped")
    else:
        print("[SHUTDOWN] RAVEN signing off.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

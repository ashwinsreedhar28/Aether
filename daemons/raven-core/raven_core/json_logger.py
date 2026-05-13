"""
JSON Logger Module - Structured logging for daemon communication.

When --json-output is enabled, all logs are emitted as JSON lines
that can be parsed by the raven-daemon.
"""

import json
import sys
from datetime import datetime
from typing import Any


class JsonLogger:
    """
    Structured JSON logger for daemon communication.

    Outputs JSON lines to stdout for the daemon to parse and broadcast
    to connected WebSocket clients.
    """

    _enabled: bool = False

    @classmethod
    def enable(cls) -> None:
        """Enable JSON output mode."""
        cls._enabled = True

    @classmethod
    def disable(cls) -> None:
        """Disable JSON output mode (use regular print)."""
        cls._enabled = False

    @classmethod
    def is_enabled(cls) -> bool:
        """Check if JSON output is enabled."""
        return cls._enabled

    @classmethod
    def _emit(cls, event_type: str, **data: Any) -> None:
        """
        Emit a JSON log line.

        Args:
            event_type: Type of event (status, transcript, function_call, etc.)
            **data: Additional data for the event
        """
        if not cls._enabled:
            return

        entry = {
            "type": event_type,
            "timestamp": datetime.now().isoformat(),
            **data
        }
        print(json.dumps(entry), flush=True)

    @classmethod
    def status(cls, status: str, **extra: Any) -> None:
        """
        Log a status change.

        Args:
            status: Current status (initializing, running, stopping, etc.)
            **extra: Additional status data
        """
        cls._emit("status", status=status, **extra)

    @classmethod
    def transcript(cls, speaker: str, text: str, **extra: Any) -> None:
        """
        Log a transcript entry.

        Args:
            speaker: Who is speaking (user, raven, system)
            text: The transcript text
            **extra: Additional transcript data
        """
        cls._emit("transcript", speaker=speaker, text=text, **extra)

    @classmethod
    def function_call(cls, name: str, args: dict, call_id: str | None = None) -> None:
        """
        Log a function call.

        Args:
            name: Function name
            args: Function arguments
            call_id: Optional call ID for correlation
        """
        cls._emit("function_call", name=name, args=args, call_id=call_id)

    @classmethod
    def function_result(
        cls,
        name: str,
        result: dict,
        duration_ms: int | None = None,
        call_id: str | None = None
    ) -> None:
        """
        Log a function result.

        Args:
            name: Function name
            result: Function result
            duration_ms: Execution duration in milliseconds
            call_id: Optional call ID for correlation
        """
        cls._emit(
            "function_result",
            name=name,
            result=result,
            duration_ms=duration_ms,
            call_id=call_id
        )

    @classmethod
    def function_error(cls, name: str, error: str, call_id: str | None = None) -> None:
        """
        Log a function error.

        Args:
            name: Function name
            error: Error message
            call_id: Optional call ID for correlation
        """
        cls._emit("function_error", name=name, error=error, call_id=call_id)

    @classmethod
    def error(cls, message: str, **extra: Any) -> None:
        """
        Log an error.

        Args:
            message: Error message
            **extra: Additional error data
        """
        cls._emit("error", message=message, **extra)

    @classmethod
    def mode_change(cls, old_mode: str, new_mode: str) -> None:
        """
        Log a visual mode change.

        Args:
            old_mode: Previous visual mode
            new_mode: New visual mode
        """
        cls._emit("mode_change", old_mode=old_mode, new_mode=new_mode)

    @classmethod
    def audio_stats(cls, direction: str, chunk_count: int) -> None:
        """
        Log audio statistics.

        Args:
            direction: Audio direction (input, output)
            chunk_count: Number of chunks processed
        """
        cls._emit("audio_stats", direction=direction, chunk_count=chunk_count)


# Convenience function for conditional logging
def log_or_print(message: str, json_type: str | None = None, **json_data: Any) -> None:
    """
    Log as JSON if enabled, otherwise print normally.

    Args:
        message: Message to print (when JSON disabled)
        json_type: JSON event type (when JSON enabled)
        **json_data: Additional JSON data
    """
    if JsonLogger.is_enabled() and json_type:
        JsonLogger._emit(json_type, message=message, **json_data)
    else:
        print(message)

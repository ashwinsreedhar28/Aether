"""
Configuration Module - Load settings, prompts, and API keys.

Supports:
- Package defaults from raven_core/prompts/prompts.json
- User overrides from ~/.raven/prompts.json and ~/.raven/config.json
- Environment variables from .env file
"""

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def _load_dotenv(env_path: Path) -> None:
    """
    Load environment variables from a .env file.

    Args:
        env_path: Path to the .env file
    """
    if not env_path.exists():
        return

    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                # Skip empty lines and comments
                if not line or line.startswith("#"):
                    continue
                # Parse KEY=value
                if "=" in line:
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip()
                    # Remove quotes if present
                    if value and value[0] in ('"', "'") and value[-1] == value[0]:
                        value = value[1:-1]
                    # Only set if not already set (env vars take precedence)
                    if key and value and key not in os.environ:
                        os.environ[key] = value
        print(f"[CONFIG] Loaded environment from {env_path}")
    except OSError as e:
        print(f"[CONFIG] Warning: Could not load .env file: {e}")


def _deep_merge(base: dict, override: dict) -> dict:
    """
    Deep merge two dictionaries.
    Override values take precedence.
    """
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


@dataclass
class Config:
    """RAVEN configuration."""

    # API Keys
    gemini_api_key: str = ""

    # Model settings
    model: str = "models/gemini-2.5-flash-native-audio-preview-09-2025"
    voice_name: str = "Aoede"

    # Audio settings
    send_sample_rate: int = 16000
    receive_sample_rate: int = 24000
    chunk_size: int = 1024

    # Audio device settings (None = use system default)
    audio_input_device: int | str | None = None
    audio_output_device: int | str | None = None

    # Context window settings
    trigger_tokens: int = 25600
    sliding_window_tokens: int = 12800

    # Prompts
    system_instruction: str = ""
    function_descriptions: dict = field(default_factory=dict)
    cerebras_system_instruction: str = ""

    # User directory — RAVEN_USER_DIR is set by the homeOS shell daemon-manager
    # so config / memory live under Electron's userData root, not ~/.raven.
    user_dir: Path = field(
        default_factory=lambda: Path(os.environ["RAVEN_USER_DIR"])
        if os.environ.get("RAVEN_USER_DIR")
        else Path.home() / ".raven"
    )

    # Allowed apps for system control
    allowed_apps: list[str] = field(default_factory=list)

    @classmethod
    def load(
        cls,
        package_prompts_path: Path | None = None,
        env_file: Path | None = None,
    ) -> "Config":
        """
        Load configuration from package defaults and user overrides.

        Args:
            package_prompts_path: Path to package prompts.json (auto-detected if None)
            env_file: Path to .env file (auto-detected if None)

        Returns:
            Loaded Config instance
        """
        config = cls()

        # Load .env file from current directory or project root
        if env_file is None:
            # Try current directory first, then package parent
            for env_path in [Path.cwd() / ".env", Path(__file__).parent.parent / ".env"]:
                if env_path.exists():
                    env_file = env_path
                    break
        if env_file:
            _load_dotenv(env_file)

        # Load API key from environment
        config.gemini_api_key = os.environ.get("GEMINI_API_KEY", "")
        if not config.gemini_api_key:
            print("[CONFIG] Warning: GEMINI_API_KEY not set")

        # Determine package prompts path
        if package_prompts_path is None:
            package_prompts_path = Path(__file__).parent / "prompts" / "prompts.json"

        # Load package defaults
        prompts = {}
        if package_prompts_path.exists():
            try:
                with open(package_prompts_path, "r", encoding="utf-8") as f:
                    prompts = json.load(f)
                print(f"[CONFIG] Loaded package prompts from {package_prompts_path}")
            except (json.JSONDecodeError, OSError) as e:
                print(f"[CONFIG] Warning: Could not load package prompts: {e}")

        # Load user overrides from ~/.raven/prompts.json
        user_prompts_path = config.user_dir / "prompts.json"
        if user_prompts_path.exists():
            try:
                with open(user_prompts_path, "r", encoding="utf-8") as f:
                    user_prompts = json.load(f)
                prompts = _deep_merge(prompts, user_prompts)
                print(f"[CONFIG] Merged user prompts from {user_prompts_path}")
            except (json.JSONDecodeError, OSError) as e:
                print(f"[CONFIG] Warning: Could not load user prompts: {e}")

        # Extract prompt values
        voice_config = prompts.get("voice_assistant", {})
        config.system_instruction = voice_config.get("system_instruction", "")
        config.function_descriptions = voice_config.get("function_descriptions", {})

        cerebras_config = prompts.get("cerebras", {})
        config.cerebras_system_instruction = cerebras_config.get("system_instruction", "")

        # Load user config from ~/.raven/config.json
        user_config_path = config.user_dir / "config.json"
        if user_config_path.exists():
            try:
                with open(user_config_path, "r", encoding="utf-8") as f:
                    user_config = json.load(f)

                # Apply config overrides
                if "model" in user_config:
                    config.model = user_config["model"]
                if "voice_name" in user_config:
                    config.voice_name = user_config["voice_name"]
                if "allowed_apps" in user_config:
                    config.allowed_apps = user_config["allowed_apps"]
                if "audio_input_device" in user_config:
                    config.audio_input_device = user_config["audio_input_device"]
                if "audio_output_device" in user_config:
                    config.audio_output_device = user_config["audio_output_device"]

                print(f"[CONFIG] Loaded user config from {user_config_path}")
            except (json.JSONDecodeError, OSError) as e:
                print(f"[CONFIG] Warning: Could not load user config: {e}")

        return config

    def ensure_user_dir(self) -> None:
        """Create user directory if it doesn't exist."""
        self.user_dir.mkdir(parents=True, exist_ok=True)

    def get_prompts_dict(self) -> dict[str, Any]:
        """Return prompts as a dictionary (for compatibility)."""
        return {
            "voice_assistant": {
                "system_instruction": self.system_instruction,
                "function_descriptions": self.function_descriptions,
            },
            "cerebras": {
                "system_instruction": self.cerebras_system_instruction,
            },
        }

    def validate(self) -> list[str]:
        """
        Validate configuration.

        Returns:
            List of validation errors (empty if valid)
        """
        errors = []
        if not self.gemini_api_key:
            errors.append("GEMINI_API_KEY environment variable is not set")
        if not self.system_instruction:
            errors.append("No system instruction configured")
        return errors

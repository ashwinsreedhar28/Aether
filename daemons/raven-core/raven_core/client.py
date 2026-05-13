"""
Gemini Client Module - Wrapper for Gemini Live API connection.
"""

from google import genai
from google.genai import types

from .config import Config
from .tools import get_all_tool_declarations


def create_client(config: Config) -> genai.Client:
    """
    Create a Gemini API client.

    Args:
        config: RAVEN configuration with API key

    Returns:
        Initialized genai.Client
    """
    if not config.gemini_api_key:
        raise ValueError(
            "GEMINI_API_KEY not configured. "
            "Set the GEMINI_API_KEY environment variable."
        )

    client = genai.Client(
        http_options={"api_version": "v1beta"},
        api_key=config.gemini_api_key,
    )
    print(f"[CLIENT] Created Gemini client for model: {config.model}")
    return client


def create_live_config(config: Config) -> types.LiveConnectConfig:
    """
    Create LiveConnectConfig for Gemini Live API.

    Args:
        config: RAVEN configuration

    Returns:
        Configured LiveConnectConfig
    """
    # Get tool declarations from registry
    tools = get_all_tool_declarations()

    # Add Google Search grounding
    try:
        tools.append({"google_search": {}})
        print("[CLIENT] Google Search grounding enabled")
    except Exception as e:
        print(f"[CLIENT] Warning: Could not enable Google Search: {e}")

    live_config = types.LiveConnectConfig(
        system_instruction=config.system_instruction,
        response_modalities=["AUDIO"],
        media_resolution="MEDIA_RESOLUTION_MEDIUM",
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=config.voice_name
                )
            )
        ),
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=config.trigger_tokens,
            sliding_window=types.SlidingWindow(
                target_tokens=config.sliding_window_tokens
            ),
        ),
        tools=tools,
    )

    print(f"[CLIENT] Created LiveConnectConfig with {len(tools)} tools")
    return live_config


class GeminiSession:
    """
    Wrapper for Gemini Live API session management.

    Provides a clean interface for connecting and managing
    the live session lifecycle.
    """

    def __init__(self, config: Config):
        """
        Initialize session wrapper.

        Args:
            config: RAVEN configuration
        """
        self.config = config
        self._client: genai.Client | None = None
        self._session = None

    @property
    def client(self) -> genai.Client:
        """Get or create the Gemini client."""
        if self._client is None:
            self._client = create_client(self.config)
        return self._client

    @property
    def session(self):
        """Get the active session (None if not connected)."""
        return self._session

    async def connect(self):
        """
        Connect to Gemini Live API.

        Returns:
            Async context manager for the session
        """
        live_config = create_live_config(self.config)
        print(f"[CLIENT] Connecting to {self.config.model}...")

        # Return the async context manager
        return self.client.aio.live.connect(
            model=self.config.model,
            config=live_config,
        )

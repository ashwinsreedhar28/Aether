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


def create_live_config(
    config: Config, resumption_handle: str | None = None
) -> types.LiveConnectConfig:
    """
    Create LiveConnectConfig for Gemini Live API.

    Args:
        config: RAVEN configuration
        resumption_handle: Session-resumption handle from a previous
            connection's session_resumption_update messages. None starts
            a fresh session. Passing a handle resumes the prior
            conversation state server-side — the recovery path for the
            native-audio preview models' known habit of closing the
            websocket (1008 "Requested entity was not found") right
            after a tool response.

    Returns:
        Configured LiveConnectConfig
    """
    # Get tool declarations from registry
    tools = get_all_tool_declarations()

    # Google Search grounding is intentionally disabled this build:
    # it competes with local tools for queries like "what time is it"
    # (Search is biased toward "current information" intents and pulls
    # the answer away from get_current_time). Re-enable once we have a
    # surface that benefits from web grounding (news / research).
    # tools.append({"google_search": {}})

    # input_audio_transcription: turn on Gemini-side transcription of
    # the user's audio. The transcript text arrives on
    # response.server_content.input_transcription and is the only
    # supported way to recover "what did the user just say" from a
    # native-audio model — the audio bytes themselves are not echoed
    # back to the client. The orchestrator pushes each transcribed
    # utterance onto SessionContext.utterances so the
    # ``_session_context`` summary injected into the next tool call
    # carries the user's recent phrasing. Without this, anaphora
    # references like "tell me more about that" lose the most useful
    # disambiguating signal — the words the user actually said.
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
        input_audio_transcription=types.AudioTranscriptionConfig(),
        # output_audio_transcription: symmetric to the input side — Gemini
        # transcribes its OWN spoken reply onto
        # response.server_content.output_transcription. The audio model
        # otherwise gives the client no text for what Aether said. The
        # orchestrator tees these onto the "raven" transcript channel so the
        # CLI (and any transcript view) can echo the reply chat-style.
        output_audio_transcription=types.AudioTranscriptionConfig(),
        # session_resumption: always on, even for a fresh session
        # (handle=None). Enabling it makes the server stream periodic
        # session_resumption_update messages whose handles the
        # orchestrator caches; when the websocket dies mid-session the
        # reconnect loop passes the latest handle back here and the
        # conversation continues where it left off.
        session_resumption=types.SessionResumptionConfig(
            handle=resumption_handle
        ),
        tools=tools,
    )

    # ``len(tools)`` counts ``types.Tool`` groups, not function declarations — modules vary in packing, so log both.
    function_count = sum(
        len(tool.function_declarations or []) for tool in tools
    )
    print(
        f"[CLIENT] Created LiveConnectConfig with {function_count} "
        f"function(s) across {len(tools)} tool group(s)"
    )
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

"""
Cerebras Tool - Call Cerebras AI to generate HTML/visual content.
"""

import threading
from typing import Any

import requests
from google.genai import types

FUNCTIONS = ["call_cerebra"]

# Cerebras API endpoint (configurable)
CEREBRA_URL = "http://localhost:5001/api/chat"
UPDATE_URL = "http://localhost:5001/api/update"


def _call_cerebra_background(
    prompt: str,
    update_frontend: bool = True,
    system_instruction: str | None = None,
) -> None:
    """
    Background function that actually calls the Cerebras API.
    This runs in a separate thread so it doesn't block the voice assistant.

    Args:
        prompt: The prompt to send to Cerebras
        update_frontend: Whether to push result to frontend
        system_instruction: Optional system instruction override
    """
    try:
        # Prepare the request - each call is stateless
        messages = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})
        messages.append({"role": "user", "content": prompt})

        payload = {"messages": messages}

        print(f"[CEREBRA] Starting background generation for prompt: {prompt[:50]}...")

        # Make the API call
        response = requests.post(CEREBRA_URL, json=payload, timeout=60)
        response.raise_for_status()

        result = response.json()
        result_type = result.get("type", "text")
        content = result.get("content", "")

        print(
            f"[CEREBRA] Content generated successfully: type={result_type}, length={len(content)}"
        )

        # Optionally update the frontend
        if update_frontend:
            try:
                requests.post(
                    UPDATE_URL,
                    json={"type": result_type, "content": content},
                    timeout=5,
                )
                print("[CEREBRA] Frontend updated successfully")
            except Exception as e:
                print(f"[CEREBRA] Warning: Could not update frontend: {e}")

    except requests.exceptions.RequestException as e:
        print(f"[CEREBRA] Error: Failed to connect to Cerebras API: {e}")
    except Exception as e:
        print(f"[CEREBRA] Error: Unexpected error: {e}")


def call_cerebra(prompt: str, update_frontend: bool = True) -> dict[str, str]:
    """
    Call the Cerebras API to generate content.
    Returns immediately while the actual API call happens in background.

    Args:
        prompt: The prompt/question to send to Cerebras
        update_frontend: Whether to push the result to the frontend

    Returns:
        Status dict indicating generation has started
    """
    # Start the API call in a background thread
    thread = threading.Thread(
        target=_call_cerebra_background,
        args=(prompt, update_frontend),
        daemon=True,
    )
    thread.start()
    print("[CEREBRA] Started background generation thread")

    return {
        "status": "success",
        "message": "Content generation started",
        "content": "Content is being generated and will appear on the frontend shortly.",
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for Cerebras tool."""
    func = types.FunctionDeclaration(
        name="call_cerebra",
        description=(
            "Call the Cerebras AI to generate HTML content or visual interfaces. "
            "Use this when the user asks to create, generate, or build something visual, "
            "and when you respond so your answers have a visual component. "
            "The result will automatically update the frontend interface."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "prompt": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "The prompt or question to send to Cerebras AI. "
                        "Be specific about what HTML/content you want generated."
                    ),
                ),
                "update_frontend": types.Schema(
                    type=types.Type.BOOLEAN,
                    description="Whether to update the frontend interface with the result (default: true)",
                ),
            },
            required=["prompt"],
        ),
    )
    return [types.Tool(function_declarations=[func])]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Handle function calls for Cerebras tool."""
    if name == "call_cerebra":
        prompt = args.get("prompt", "")
        update_frontend = args.get("update_frontend", True)
        return call_cerebra(prompt, update_frontend)
    return None

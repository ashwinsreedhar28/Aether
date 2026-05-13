"""
Memory Tool - Store and retrieve notes/memories.
"""

from typing import Any

from google.genai import types

from ..memory.store import get_memory_store

FUNCTIONS = ["remember_note", "search_notes", "list_notes", "delete_note"]


def remember_note(text: str, tags: list[str] | None = None) -> dict[str, Any]:
    """
    Store a note in memory.

    Args:
        text: The note content to remember
        tags: Optional tags for categorization

    Returns:
        Confirmation with note ID
    """
    store = get_memory_store()
    note_id = store.add_note(text, tags)
    print(f"[MEMORY] Stored note {note_id}: {text[:50]}...")
    return {
        "status": "success",
        "note_id": note_id,
        "message": f"Note saved with ID {note_id}",
    }


def search_notes(query: str) -> dict[str, Any]:
    """
    Search for notes matching a query.

    Args:
        query: Search string to match

    Returns:
        List of matching notes
    """
    store = get_memory_store()
    results = store.search_notes(query)
    print(f"[MEMORY] Search '{query}' found {len(results)} results")
    return {
        "count": len(results),
        "notes": [
            {"id": n.id, "text": n.text, "tags": n.tags, "created_at": n.created_at}
            for n in results
        ],
    }


def list_notes(limit: int = 10) -> dict[str, Any]:
    """
    List recent notes.

    Args:
        limit: Maximum number of notes to return

    Returns:
        List of recent notes
    """
    store = get_memory_store()
    notes = store.list_recent(limit)
    print(f"[MEMORY] Listed {len(notes)} recent notes")
    return {
        "count": len(notes),
        "total": store.count(),
        "notes": [
            {"id": n.id, "text": n.text, "tags": n.tags, "created_at": n.created_at}
            for n in notes
        ],
    }


def delete_note(note_id: str) -> dict[str, Any]:
    """
    Delete a note by ID.

    Args:
        note_id: The ID of the note to delete

    Returns:
        Confirmation of deletion
    """
    store = get_memory_store()
    if store.delete_note(note_id):
        print(f"[MEMORY] Deleted note {note_id}")
        return {"status": "success", "message": f"Note {note_id} deleted"}
    else:
        print(f"[MEMORY] Note {note_id} not found")
        return {"status": "error", "message": f"Note {note_id} not found"}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for memory tool."""
    remember_func = types.FunctionDeclaration(
        name="remember_note",
        description=(
            "Store a note or piece of information in memory for later recall. "
            "Use this when the user wants you to remember something, like facts, "
            "preferences, reminders, or any information they mention wanting to keep."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "text": types.Schema(
                    type=types.Type.STRING,
                    description="The note or information to remember",
                ),
                "tags": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.STRING),
                    description="Optional tags for categorization (e.g., 'personal', 'work', 'reminder')",
                ),
            },
            required=["text"],
        ),
    )

    search_func = types.FunctionDeclaration(
        name="search_notes",
        description=(
            "Search through stored notes and memories. "
            "Use this when the user asks about something they previously told you to remember, "
            "or when they reference past information."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "query": types.Schema(
                    type=types.Type.STRING,
                    description="Search query to find matching notes",
                ),
            },
            required=["query"],
        ),
    )

    list_func = types.FunctionDeclaration(
        name="list_notes",
        description=(
            "List recent notes from memory. "
            "Use this when the user asks to see what you remember or wants a summary of stored notes."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "limit": types.Schema(
                    type=types.Type.INTEGER,
                    description="Maximum number of notes to return (default: 10)",
                ),
            },
        ),
    )

    delete_func = types.FunctionDeclaration(
        name="delete_note",
        description=(
            "Delete a specific note from memory. "
            "Use when the user wants to remove a stored note."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "note_id": types.Schema(
                    type=types.Type.STRING,
                    description="The ID of the note to delete",
                ),
            },
            required=["note_id"],
        ),
    )

    return [
        types.Tool(function_declarations=[remember_func]),
        types.Tool(function_declarations=[search_func]),
        types.Tool(function_declarations=[list_func]),
        types.Tool(function_declarations=[delete_func]),
    ]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Handle function calls for memory tool."""
    if name == "remember_note":
        text = args.get("text", "")
        tags = args.get("tags")
        return remember_note(text, tags)
    elif name == "search_notes":
        query = args.get("query", "")
        return search_notes(query)
    elif name == "list_notes":
        limit = args.get("limit", 10)
        return list_notes(limit)
    elif name == "delete_note":
        note_id = args.get("note_id", "")
        return delete_note(note_id)
    return None

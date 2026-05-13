"""
Memory Store - Persistent note storage for RAVEN.

Stores notes in ~/.raven/notes.json with the following format:
{
    "notes": [
        {
            "id": "uuid",
            "text": "Note content",
            "tags": ["tag1", "tag2"],
            "created_at": "2025-12-05T10:30:00"
        }
    ]
}
"""

import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from dataclasses import dataclass, asdict


def _default_user_dir() -> Path:
    # homeOS passes its Electron userData root via RAVEN_USER_DIR so that
    # memory + config live inside the shell's per-app data dir rather than
    # ~/.raven (which VIEWER used). The fallback keeps the daemon runnable
    # standalone (e.g. for direct CLI use).
    env_dir = os.environ.get("RAVEN_USER_DIR")
    if env_dir:
        return Path(env_dir)
    return Path.home() / ".raven"


@dataclass
class Note:
    """A single note in the memory store."""

    id: str
    text: str
    tags: list[str]
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Note":
        return cls(
            id=data["id"],
            text=data["text"],
            tags=data.get("tags", []),
            created_at=data["created_at"],
        )


class MemoryStore:
    """
    Persistent memory storage using JSON files.
    Notes persist forever until explicitly deleted.
    """

    def __init__(self, storage_path: Path | None = None):
        """
        Initialize the memory store.

        Args:
            storage_path: Path to the JSON storage file.
                         Defaults to ~/.raven/notes.json
        """
        if storage_path is None:
            storage_path = _default_user_dir() / "memory.json"

        self.storage_path = storage_path
        self._ensure_storage_exists()
        self._notes: list[Note] = self._load_notes()

    def _ensure_storage_exists(self) -> None:
        """Create storage directory and file if they don't exist."""
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.storage_path.exists():
            self._save_notes([])

    def _load_notes(self) -> list[Note]:
        """Load notes from the storage file."""
        try:
            with open(self.storage_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return [Note.from_dict(n) for n in data.get("notes", [])]
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _save_notes(self, notes: list[Note] | None = None) -> None:
        """Save notes to the storage file."""
        if notes is None:
            notes = self._notes
        with open(self.storage_path, "w", encoding="utf-8") as f:
            json.dump({"notes": [n.to_dict() for n in notes]}, f, indent=2)

    def add_note(self, text: str, tags: list[str] | None = None) -> str:
        """
        Add a new note to the store.

        Args:
            text: The note content
            tags: Optional list of tags for categorization

        Returns:
            The ID of the created note
        """
        note_id = str(uuid.uuid4())[:8]  # Short UUID for readability
        note = Note(
            id=note_id,
            text=text,
            tags=tags or [],
            created_at=datetime.now().isoformat(),
        )
        self._notes.append(note)
        self._save_notes()
        return note_id

    def search_notes(self, query: str) -> list[Note]:
        """
        Search notes by content or tags.

        Args:
            query: Search string to match against note text and tags

        Returns:
            List of matching notes
        """
        query_lower = query.lower()
        results = []
        for note in self._notes:
            # Check text content
            if query_lower in note.text.lower():
                results.append(note)
                continue
            # Check tags
            for tag in note.tags:
                if query_lower in tag.lower():
                    results.append(note)
                    break
        return results

    def list_recent(self, limit: int = 10) -> list[Note]:
        """
        Get the most recent notes.

        Args:
            limit: Maximum number of notes to return

        Returns:
            List of notes, most recent first
        """
        # Sort by created_at descending
        sorted_notes = sorted(
            self._notes, key=lambda n: n.created_at, reverse=True
        )
        return sorted_notes[:limit]

    def get_note(self, note_id: str) -> Note | None:
        """Get a note by ID."""
        for note in self._notes:
            if note.id == note_id:
                return note
        return None

    def delete_note(self, note_id: str) -> bool:
        """
        Delete a note by ID.

        Args:
            note_id: The ID of the note to delete

        Returns:
            True if note was deleted, False if not found
        """
        for i, note in enumerate(self._notes):
            if note.id == note_id:
                del self._notes[i]
                self._save_notes()
                return True
        return False

    def count(self) -> int:
        """Return the total number of notes."""
        return len(self._notes)


# Singleton instance for global access
_store: MemoryStore | None = None


def get_memory_store() -> MemoryStore:
    """Get the global memory store instance."""
    global _store
    if _store is None:
        _store = MemoryStore()
    return _store

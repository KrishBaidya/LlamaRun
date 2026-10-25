"""What the user's AI remembers about them (needs the ``memory`` permission).

Memories are short facts ("Works as a nurse", "Prefers metric units") shown to
the model on every message. The model adds and corrects them itself; the user
manages them in Settings > Memory. Your plugin can read and change them too::

    from llamarun import memory

    memory.add("Has a dog called Biscuit")
    for m in memory.list():
        print(m.id, m.text)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

from . import _rpc

__all__ = ["Memory", "add", "delete", "list", "update"]


@dataclass
class Memory:
    id: str
    text: str
    #: "user", "model", or a plugin's name.
    source: str
    created_at: int
    updated_at: int


def _of(m: dict) -> Memory:
    return Memory(
        id=str(m.get("id", "")),
        text=str(m.get("text", "")),
        source=str(m.get("source", "")),
        created_at=int(m.get("createdAt", 0)),
        updated_at=int(m.get("updatedAt", 0)),
    )


def list() -> List[Memory]:  # noqa: A001
    return [_of(m) for m in _rpc.call("memory.list") or []]


def add(text: str) -> Memory:
    """Save a fact (at most 500 characters). Saving the same fact twice keeps one."""
    return _of(_rpc.call("memory.add", {"text": text}))


def update(id: str, text: str) -> Memory:  # noqa: A002
    return _of(_rpc.call("memory.update", {"id": id, "text": text}))


def delete(id: str) -> bool:  # noqa: A002
    return bool(_rpc.call("memory.delete", {"id": id}))

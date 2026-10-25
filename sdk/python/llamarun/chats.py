"""Talk to your models through LlamaRun's chats, exactly as if the user typed.

A message sent with :func:`send` goes through the same pipeline as a typed
one: the chat's history, the user's MCP tools (when the plugin also has the
``mcp`` permission), other plugins' hooks and the tool-call limit. It shows up
in the chat window, live, marked as sent by your plugin::

    from llamarun import chats

    reply = chats.send("What's on my calendar today?", on_token=print)
    follow_up = chats.send("And tomorrow?", chat_id=reply.chat_id)

Needs the ``chats`` permission.

Plugins can also shape the chat itself (SDK 1.4):

* :func:`post` puts the plugin's own message in a chat: Markdown, a live
  ```html preview, or images. No model is involved. (``commands`` or ``chats``)
* :func:`add_command` adds a ``/command`` to the chat box; whatever the
  handler returns is posted as the reply. (``commands``)
* :func:`set_context` adds live information to every message the user's
  models see, e.g. the active window or today's calendar. (``context``)
* :func:`compact` summarises a chat's older messages, like ``/compact``. (``chats``)
"""

from __future__ import annotations

import itertools
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from . import _rpc

__all__ = [
    "ChatReply",
    "ChatSummary",
    "Posted",
    "ToolUse",
    "add_command",
    "cancel",
    "clear_context",
    "compact",
    "continue_",
    "get",
    "list",
    "open",
    "post",
    "remove_command",
    "send",
    "set_context",
]

TokenHandler = Callable[[str], None]
ToolHandler = Callable[["ToolUse"], None]


@dataclass
class ToolUse:
    name: str
    server: str = ""


@dataclass
class ChatReply:
    chat_id: str
    message_id: str
    text: str
    status: str
    """``"done"``, ``"error"`` or ``"cancelled"``."""
    error: Optional[str] = None
    model: Optional[str] = None
    tools: List[ToolUse] = field(default_factory=list)
    paused: bool = False
    """The model hit the tool-call limit. :func:`continue_` carries on where it stopped."""

    @property
    def ok(self) -> bool:
        return self.status == "done"


@dataclass
class ChatSummary:
    id: str
    title: str
    model: str
    updated_at: int
    message_count: int
    preview: str


# --------------------------------------------------------------- streaming

_ids = itertools.count(1)
_streams: Dict[str, "_Stream"] = {}
_streams_lock = threading.Lock()


class _Stream:
    """Delivers a turn's tokens and tool calls in order. The host numbers them,
    because incoming messages are handled on a thread pool."""

    def __init__(self, on_token: Optional[TokenHandler], on_tool: Optional[ToolHandler], on_start):
        self.on_token, self.on_tool, self.on_start = on_token, on_tool, on_start
        self._next = 0
        self._held: Dict[int, dict] = {}
        self._lock = threading.Lock()

    def push(self, message: dict) -> None:
        with self._lock:
            self._held[int(message.get("seq", 0))] = message
            while self._next in self._held:
                self._emit(self._held.pop(self._next))
                self._next += 1

    def _emit(self, message: dict) -> None:
        kind = message.get("type")
        try:
            if kind == "token" and self.on_token:
                self.on_token(str(message.get("text", "")))
            elif kind == "tool" and self.on_tool:
                self.on_tool(ToolUse(str(message.get("name", "")), str(message.get("server", ""))))
            elif kind == "start" and self.on_start:
                self.on_start(str(message.get("chat_id", "")))
        except Exception as exc:  # a bad callback must not break the stream
            from . import app

            app.log("error", f"chat stream callback failed: {exc}")


def _deliver(params: dict) -> None:
    """Called by the host for each ``chats.stream`` notification."""
    with _streams_lock:
        stream = _streams.get(str(params.get("stream", "")))
    if stream is not None:
        stream.push(params)


def _run(method: str, params: dict, on_token, on_tool, on_start) -> ChatReply:
    stream_id = ""
    if on_token or on_tool or on_start:
        stream_id = f"s{next(_ids)}"
        with _streams_lock:
            _streams[stream_id] = _Stream(on_token, on_tool, on_start)
        params["stream"] = stream_id
    try:
        result = _rpc.call(method, params) or {}
    finally:
        with _streams_lock:
            _streams.pop(stream_id, None)
    return ChatReply(
        chat_id=str(result.get("chat_id", "")),
        message_id=str(result.get("message_id", "")),
        text=str(result.get("text") or ""),
        status=str(result.get("status", "done")),
        error=result.get("error"),
        model=result.get("model"),
        tools=[ToolUse(str(t.get("name", "")), str(t.get("server", ""))) for t in result.get("tools") or []],
        paused=bool(result.get("paused")),
    )


# ------------------------------------------------------------------- API


def send(
    text: str,
    *,
    chat_id: Optional[str] = None,
    model: Optional[str] = None,
    instructions: Optional[str] = None,
    tools: bool = True,
    save: bool = True,
    voice: bool = False,
    on_token: Optional[TokenHandler] = None,
    on_tool: Optional[ToolHandler] = None,
    on_start: Optional[Callable[[str], None]] = None,
) -> ChatReply:
    """Send ``text`` as the user and wait for the reply.

    - ``chat_id``: continue that chat; ``None`` starts a new one.
    - ``model``: model id for this message (and the chat from now on). Defaults to the chat's model, or the one selected in Settings for a new chat.
    - ``instructions``: extra guidance for this reply only, e.g. "answers are read aloud". Not shown in the chat or kept in its history.
    - ``tools``: offer the user's MCP tools. Needs the ``mcp`` permission as well; without it, no tools are offered.
    - ``save``: ``False`` keeps a new chat out of the chat list and off disk.
    - ``voice``: marks the message as spoken in the chat window.
    - ``on_token`` gets the reply as it streams, ``on_tool`` each MCP tool the model uses, ``on_start`` the chat id as soon as it is known (so the chat can be opened or cancelled while the reply is still coming).

    Blocks until the reply is finished, so call it from a worker thread when
    your plugin must stay responsive. Errors from the model come back as a
    reply with ``status == "error"``; problems with the request itself raise
    :class:`~llamarun.PluginError`.
    """
    params: Dict[str, Any] = {"text": str(text), "tools": bool(tools), "save": bool(save), "voice": bool(voice)}
    if chat_id:
        params["chat_id"] = chat_id
    if model:
        params["model"] = model
    if instructions:
        params["instructions"] = str(instructions)
    return _run("chats.send", params, on_token, on_tool, on_start)


def continue_(
    chat_id: str,
    *,
    on_token: Optional[TokenHandler] = None,
    on_tool: Optional[ToolHandler] = None,
) -> ChatReply:
    """Carry on a reply that stopped at the tool-call limit (``reply.paused``).

    The tool calls the model had asked for run, then the saved conversation is
    sent once: nothing already done is repeated. The new text is added to the
    same reply; the returned ``text`` is the whole reply so far.
    """
    return _run("chats.continue", {"chat_id": chat_id}, on_token, on_tool, None)


def cancel(chat_id: str) -> None:
    """Stop the reply being generated in ``chat_id``. The pending :func:`send` returns with ``status == "cancelled"``."""
    _rpc.call("chats.cancel", {"chat_id": chat_id})


def list() -> List[ChatSummary]:  # noqa: A001 - mirrors the other SDK modules
    """The user's saved chats, newest first."""
    return [
        ChatSummary(
            id=str(c.get("id", "")),
            title=str(c.get("title", "")),
            model=str(c.get("model", "")),
            updated_at=int(c.get("updatedAt", 0)),
            message_count=int(c.get("messageCount", 0)),
            preview=str(c.get("preview", "")),
        )
        for c in _rpc.call("chats.list") or []
    ]


def get(chat_id: str) -> Optional[dict]:
    """A chat with all its messages, as the app stores it, or ``None``."""
    return _rpc.call("chats.get", {"chat_id": chat_id})


def open(chat_id: str) -> None:  # noqa: A001
    """Show the chat in the chat window."""
    _rpc.call("chats.open", {"chat_id": chat_id})


# ------------------------------------------------------------- posts, commands, context


@dataclass
class Posted:
    chat_id: str
    message_id: str


def post(text: str, *, chat_id: Optional[str] = None, images: Optional[List[str]] = None, open: bool = False) -> Posted:  # noqa: A002
    """Add your plugin's own message to a chat (a new one when ``chat_id`` is None).

    ``text`` is Markdown: tables, code, ``![](data:image/png;base64,...)`` images,
    and fenced ```html blocks, which the chat shows as a live, sandboxed preview.
    ``images`` are data URLs (see :func:`llamarun.ui.image_file`). Set ``open`` to
    show the chat window. The message is marked as coming from your plugin.
    """
    result = _rpc.call("chats.post", {"text": text, "chat_id": chat_id, "images": images or [], "open": open}) or {}
    return Posted(chat_id=str(result.get("chat_id", "")), message_id=str(result.get("message_id", "")))


CommandHandler = Callable[[str, str], Optional[str]]
_commands: Dict[str, CommandHandler] = {}
_commands_lock = threading.Lock()


def add_command(name: str, handler: CommandHandler, *, description: str = "", args: str = "") -> None:
    """Add ``/name`` to the chat box. Typing ``/name some text`` calls ``handler("some text", chat_id)``
    instead of a model; return Markdown to post as the reply (or None and post yourself).

    ``args`` is a hint shown after the name, like ``"[city]"``. Commands are removed when the plugin stops.
    """
    key = name.lstrip("/").lower()
    _rpc.call("commands.register", {"name": key, "description": description, "args": args})
    with _commands_lock:
        _commands[key] = handler


def remove_command(name: str) -> None:
    key = name.lstrip("/").lower()
    with _commands_lock:
        _commands.pop(key, None)
    _rpc.call("commands.unregister", {"name": key})


def _run_command(params: dict) -> Optional[str]:
    with _commands_lock:
        handler = _commands.get(str(params.get("name", "")))
    if handler is None:
        return None
    reply = handler(str(params.get("args", "")), str(params.get("chat_id", "")))
    return None if reply is None else str(reply)


def set_context(text: str, *, key: str = "default") -> None:
    """Add ``text`` to the instructions of every chat message the user sends (up to 4,000 characters).

    Call it again with new text to update it, e.g. on a timer; each ``key`` is a separate block.
    Cleared when the plugin stops.
    """
    _rpc.call("context.set", {"key": key, "text": text})


def clear_context(key: Optional[str] = None) -> None:
    """Remove one context block, or all of this plugin's when ``key`` is None."""
    _rpc.call("context.clear", {"key": key})


def compact(chat_id: str, instructions: str = "") -> None:
    """Summarise a chat's older messages now, like typing ``/compact instructions``."""
    _rpc.call("chats.compact", {"chat_id": chat_id, "instructions": instructions or None})

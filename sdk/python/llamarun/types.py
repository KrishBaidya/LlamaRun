"""Context objects passed to plugin hooks."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class TextGenerationContext:
    """Passed to ``on_before_text_generation``.

    Edit ``input_text`` or ``model`` and return the context to change what is
    generated, or set ``cancel = True`` to stop generation altogether.
    """

    input_text: str
    model: str
    cancel: bool = False


@dataclass
class ToolCallContext:
    """Passed to ``on_before_tool_call`` (needs the ``hooks`` permission).

    Set ``block = True`` (and a ``reason`` the model is told) and return the
    context to stop the call.
    """

    tool: str
    arguments: dict
    chat_id: str
    block: bool = False
    reason: str = ""


@dataclass
class ToolCallResult:
    """Passed to ``on_after_tool_call``: the call and its result as text."""

    tool: str
    arguments: dict
    result: str
    chat_id: str
    is_error: bool = False


@dataclass
class SessionContext:
    """Passed to ``on_session_start``: a new chat's first message is about to be answered."""

    chat_id: str
    cwd: str


@dataclass
class StopContext:
    """Passed to ``on_stop``: a reply to the user's message finished.

    ``again`` is true when this reply already continued because a stop hook
    asked it to, so a plugin can avoid keeping the model going forever.
    """

    chat_id: str
    cwd: str
    response_text: str
    again: bool = False


@dataclass
class TextGenerationResult:
    """Passed to ``on_after_text_generation``.

    Return a result with a different ``response_text`` to rewrite what the user sees.
    """

    input_text: str
    response_text: str
    model: str

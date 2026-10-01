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
class TextGenerationResult:
    """Passed to ``on_after_text_generation``.

    Return a result with a different ``response_text`` to rewrite what the user sees.
    """

    input_text: str
    response_text: str
    model: str

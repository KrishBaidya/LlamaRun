"""Access to the language models configured in LlamaRun."""

from __future__ import annotations

from typing import List, Optional

from . import _rpc


def get_selected_model() -> str:
    """Return the id of the model selected in Settings (may be empty)."""
    return str(_rpc.call("llm.get_selected_model"))


def get_available_models() -> List[str]:
    """Return ids of all usable models: cloud models plus locally installed Ollama models."""
    return [str(m) for m in _rpc.call("llm.get_available_models") or []]


def generate(prompt: str, *, model: Optional[str] = None) -> str:
    """Generate a complete response for ``prompt`` and return it as text.

    Runs headlessly: nothing is shown in the overlay and plugin generation
    hooks are *not* fired, so it is safe to call from inside a hook.
    ``model`` defaults to the currently selected model.
    """
    params = {"prompt": str(prompt)}
    if model:
        params["model"] = model
    return str(_rpc.call("llm.generate", params))

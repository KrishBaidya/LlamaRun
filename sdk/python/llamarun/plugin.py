"""The base class every LlamaRun plugin subclasses."""

from __future__ import annotations

import contextvars
import threading
from typing import Any, Callable, Optional

from .types import TextGenerationContext, TextGenerationResult


class Plugin:
    """Base class for LlamaRun plugins.

    All hooks are no-ops by default, so override only what you need. Hooks run
    on a background thread, never on the UI thread, so blocking work is fine.

    Plugins are instantiated with no arguments. Use ``on_load`` for setup rather
    than ``__init__`` so that errors are reported against the hook.
    """

    def on_load(self) -> None:
        """Called once after the plugin is imported and instantiated."""

    def on_unload(self) -> None:
        """Called when the app shuts down, or the plugin is reloaded or removed."""

    def on_before_text_generation(self, ctx: TextGenerationContext) -> Optional[TextGenerationContext]:
        """Called before a prompt is sent to the model.

        Return a (possibly modified) context to replace it for later plugins and
        for generation, or ``None`` to leave it unchanged. Returning a context
        with ``cancel=True`` stops generation; later plugins are not called.
        """
        return None

    def on_after_text_generation(self, result: TextGenerationResult) -> Optional[TextGenerationResult]:
        """Called after the model has finished responding.

        Return a (possibly modified) result to replace it, or ``None``.
        """
        return None

    def start_thread(self, target: Callable[..., Any], *args: Any, name: Optional[str] = None) -> threading.Thread:
        """Run ``target(*args)`` on a new daemon thread that acts on behalf of this plugin.

        A plain ``threading.Thread`` does not know which plugin started it, so
        ``storage``, ``app.log`` and ``app.get_data_dir`` would fall back to the
        working directory. Threads started here keep the plugin's identity.
        Call it from ``on_load``, a hook or an action, and stop the thread in
        ``on_unload``.
        """
        context = contextvars.copy_context()
        thread = threading.Thread(
            target=context.run, args=(target, *args), name=name or type(self).__name__, daemon=True
        )
        thread.start()
        return thread

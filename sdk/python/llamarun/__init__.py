"""LlamaRun Python plugin SDK.

A minimal plugin::

    import llamarun
    from llamarun import app, ui

    class Hello(llamarun.Plugin):
        def on_load(self):
            ui.settings(ui.Switch("greet", "Say hello on startup", default=True))

        def on_before_text_generation(self, ctx):
            app.log("info", f"Prompt: {ctx.input_text}")
            return None

See ``docs/plugin-sdk.md`` in the LlamaRun repository for the full guide.
"""

from . import app, chats, events, llm, mcp, permissions, plugins, settings, shared, storage, ui
from .errors import PluginError
from .plugin import Plugin
from .plugins import expose
from .types import TextGenerationContext, TextGenerationResult

__version__ = "1.2"
"""SDK API version (MAJOR.MINOR). Plugins declare the version they target in ``sdk_version``."""

__all__ = [
    "Plugin",
    "PluginError",
    "TextGenerationContext",
    "TextGenerationResult",
    "app",
    "chats",
    "events",
    "expose",
    "llm",
    "mcp",
    "permissions",
    "plugins",
    "settings",
    "shared",
    "storage",
    "ui",
    "__version__",
]

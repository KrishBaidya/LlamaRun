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

from . import app, chats, events, llm, mcp, memory, permissions, plugins, settings, shared, skills, storage, tools, ui
from .errors import PluginError
from .plugin import Plugin
from .plugins import expose
from .tools import ToolError, tool
from .types import TextGenerationContext, TextGenerationResult

__version__ = "1.4"
"""SDK API version (MAJOR.MINOR). Plugins declare the version they target in ``sdk_version``."""

__all__ = [
    "Plugin",
    "PluginError",
    "TextGenerationContext",
    "TextGenerationResult",
    "ToolError",
    "app",
    "chats",
    "events",
    "expose",
    "llm",
    "mcp",
    "memory",
    "permissions",
    "plugins",
    "settings",
    "shared",
    "skills",
    "storage",
    "tool",
    "tools",
    "ui",
    "__version__",
]

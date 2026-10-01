"""Reference plugin for the LlamaRun Python SDK.

Exercises the core of the SDK: both generation hooks, the load/unload
lifecycle, a settings form, a custom action, and the app, llm, storage and
mcp modules. It asks for the "hooks", "llm" and "mcp" permissions in
plugin.json; nothing else (no files, network or programs).

To try it, open Settings -> Plugins -> Install from Disk and pick this folder.
"""

import llamarun
from llamarun import app, llm, mcp, settings, storage, ui


class PromptLogger(llamarun.Plugin):
    """Counts prompts, expands a shortcut, and blocks empty generations."""

    def on_load(self) -> None:
        # Shown on this plugin's page in Settings -> Plugins; the app saves the values.
        ui.settings(
            ui.Input("cancel_prefix", "Cancel prefix", default="/skip",
                     description="Messages starting with this are not sent to the model."),
            ui.Input("expand_prefix", "Summarize shortcut", default="/summarize",
                     description="Replaced with an instruction to summarize the rest of the message."),
            ui.Switch("keep_responses", "Remember the last response", default=True),
        )

        count = storage.get("prompt_count", 0)
        app.log("info", f"Prompt Logger loaded. {count} prompts seen so far.")
        app.log("debug", f"Running on LlamaRun {app.get_version()}, SDK {llamarun.__version__}")

        # Available models and MCP tools are useful to log once at startup.
        app.log("debug", f"Models available: {', '.join(llm.get_available_models())}")
        try:
            tools = mcp.list_tools()
            app.log("debug", f"MCP tools: {', '.join(t.name for t in tools) or '(none)'}")
        except llamarun.PluginError as exc:
            app.log("warning", f"Could not list MCP tools: {exc}")

    def on_unload(self) -> None:
        app.log("info", f"Prompt Logger unloading. Final count: {storage.get('prompt_count', 0)}.")

    def on_before_text_generation(self, ctx):
        text = ctx.input_text.strip()
        cancel_prefix = settings.get("cancel_prefix") or "/skip"
        expand_prefix = settings.get("expand_prefix") or "/summarize"

        # Cancel is first-wins: returning cancel=True stops dispatch, so plugins
        # sorted after this one will not see the prompt at all.
        if not text or text.startswith(cancel_prefix):
            app.log("info", "Cancelling generation.")
            ctx.cancel = True
            return ctx

        if text.startswith(expand_prefix):
            ctx.input_text = (
                "Summarize the following in three bullet points:\n"
                + text[len(expand_prefix):].strip()
            )
            app.log("debug", "Expanded the summarize shortcut.")

        storage.set("prompt_count", storage.get("prompt_count", 0) + 1)
        storage.set("last_prompt", ctx.input_text)

        # Returning the context replaces it for the rest of the pipeline.
        return ctx

    def on_after_text_generation(self, result):
        app.log("debug", f"Model returned {len(result.response_text)} characters.")
        if settings.get("keep_responses", True):
            storage.set("last_response", result.response_text)

        # Returning None leaves the response exactly as generated.
        return None

    def on_clear_history(self) -> None:
        """Custom action, dispatched by the "clearHistory" entry in plugin.json.

        Custom actions take no arguments and their return value is ignored.
        """
        if not ui.confirm("Clear prompt history?", "The prompt count and saved prompts are deleted.",
                          confirm_label="Clear", destructive=True):
            return
        storage.clear()
        app.notify("Prompt Logger", "Cleared stored prompt history.")

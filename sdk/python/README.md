# llamarun: LlamaRun Python plugin SDK

The Python package that LlamaRun plugins import. The app ships it together with a bundled CPython, so plugins need no setup.

Install it locally to get editor autocomplete and type checking:

```bash
pip install -e sdk/python
```

```python
import llamarun
from llamarun import settings, storage, ui

class MyPlugin(llamarun.Plugin):
    def on_load(self):
        ui.settings(ui.Switch("remember", "Remember the last prompt", default=True))

    def on_before_text_generation(self, ctx):      # needs "permissions": ["hooks"]
        if settings.get("remember"):
            storage.set("last", ctx.input_text)
        return None
```

Modules:
- `app`, `llm`, `mcp` and `storage` cover the app (including global shortcuts), your models, MCP tools and private storage.
- `chats` sends messages into the user's chats and streams the replies, with MCP tools.
- `ui` draws UI with the app's own components: a settings page, a status HUD, dialogs, toasts, and Python or TSX panels.
- `settings` reads the settings page's values.
- `plugins`, `events` and `shared` let plugins work together.
- `permissions` reports what the plugin has been allowed to do.

See [docs/plugin-sdk.md](../../docs/plugin-sdk.md) for the full guide. `plugin_host.py` is the runner the app launches, one process per plugin; `llamarun/_sandbox.py` enforces the permissions. Run the tests with `npm run test:sdk`.

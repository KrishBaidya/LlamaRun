# LlamaRun Plugin SDK (Python)

LlamaRun plugins are Python packages that hook into chats, talk to your models in chats, and use MCP tools, storage and notifications. They can also build UI that the app draws with its own components: a settings page, status cards, dialogs, toasts and windows. Plugins run on the **bundled CPython 3.13**, so users don't need Python installed. Each plugin runs **in its own process with only the permissions the user allowed**.

- SDK version: **1.3** (`llamarun.__version__`). 1.3 adds [tools for your models](#tools-for-your-models-needs-tools) and [installing MCP servers and plugins](#installing-mcp-servers-and-plugins-needs-install). 1.2 added [`llamarun.chats`](#llamarunchats-needs-chats) and [global shortcuts](#llamarunapp).
- Examples:
  - [`examples/plugins/prompt_logger`](../examples/plugins/prompt_logger) uses the chat hooks and a settings page.
  - [`examples/plugins/ui_showcase`](../examples/plugins/ui_showcase) uses every kind of UI and exposes a service to other plugins.
  - Edith, the voice assistant in the LlamaRunPythonSamples repository, uses `chats`, MCP tools, a HUD, a settings page and a global shortcut.
  - Plugin Creator, also in LlamaRunPythonSamples, gives models tools to find and add MCP servers, and to write and install plugins.

## Quick start

A plugin is a folder with a manifest and a module:

```
my_plugin/
├─ plugin.json
├─ my_plugin.py
├─ ui/               (optional: TSX panels)
├─ requirements.txt  (optional: installed with pip into .deps/ on install)
└─ icon.png          (optional: shown in Settings → Plugins)
```

`plugin.json`:

```json
{
  "name": "My Plugin",
  "description": "What it does",
  "version": "1.0.0",
  "author": "You",
  "sdk_version": "1.1",
  "entry": { "module": "my_plugin", "class": "MyPlugin" },
  "permissions": ["hooks"],
  "actions": { "Say hello": "on_say_hello" }
}
```

`my_plugin.py`:

```python
import llamarun
from llamarun import settings, ui


class MyPlugin(llamarun.Plugin):
    def on_load(self):
        ui.settings(ui.Input("prefix", "Shout prefix", default="/shout "))

    def on_before_text_generation(self, ctx):
        prefix = settings.get("prefix")
        if ctx.input_text.startswith(prefix):
            ctx.input_text = ctx.input_text[len(prefix):].upper()
            return ctx          # replace the context
        return None             # leave it unchanged

    def on_say_hello(self):
        ui.toast("Hello!", kind="success")
```

To try it, go to **Settings → Plugins → Install from Disk** and pick the folder or a `.zip`. While you're developing, choose **Link folder for development** instead (see [Development workflow](#development-workflow)).

## Manifest

| Field | Required | Notes |
|---|---|---|
| `name`, `description`, `version`, `author` | yes | Shown in the Plugins page. `name` is a free-text display name. |
| `sdk_version` | yes | `"MAJOR.MINOR"`. The plugin loads when the major version matches the app's SDK and the minor version isn't newer. |
| `entry.module` | yes | Module to import (a Python identifier). Must be unique across installed plugins. It also names the plugin's data folder and is how other plugins refer to it. |
| `entry.class` | yes | Class to instantiate. It must subclass `llamarun.Plugin`. |
| `permissions` | yes, from SDK 1.1 | What the plugin needs. See [Permissions and the sandbox](#permissions-and-the-sandbox). Use `[]` if it needs none. |
| `actions` | no | Maps menu labels to method names. The methods take no arguments. They appear on the plugin's page and in its `⋯` menu. |
| `dependencies` | no | Other plugins this one uses, by module: `{"ui_showcase": ">=1.0"}`. Accepted ranges look like `>=1.2`, `^1.0`, `~1.2` or `1.4`. |
| `shared` | no | `{"writers": ["module", …]}` or `["*"]`: which dependents may write to this plugin's [shared state](#shared-state). |
| `ui.panels` | no | TSX panels: `{"History": "ui/History.tsx"}`. See [TSX panels](#tsx-panels). |

Validation errors are reported per field and shown on the plugin's card.

## Permissions and the sandbox

Every plugin runs in its own Python process. A plugin that crashes or hangs affects only itself: LlamaRun restarts it with backoff and skips it for the chat turn it was holding up. A plugin can only do what its manifest asks for and the user approved. When a plugin is installed, LlamaRun shows its permissions. The user can untick optional ones, and can change them later on the plugin's page. Turning one off restarts the plugin.

| Permission | Allows | Enforcement |
|---|---|---|
| `hooks` | Seeing and rewriting chat messages (`on_before/after_text_generation`) | The app only sends hook events to plugins that have this. |
| `llm` | `llm.generate`, `llm.get_available_models`, `llm.get_selected_model` | The app checks each call. |
| `chats` | `llamarun.chats`: sending messages as the user and reading their chats | The app checks each call. |
| `mcp` | `mcp.list_tools`, `mcp.call_tool`, and MCP tools in `chats.send` | The app checks each call. |
| `tools` | Offering `@llamarun.tool` methods to models in chats | The app only offers tools of plugins that have this. |
| `install` | Browsing the MCP directory, and asking to add MCP servers and install plugins | The app checks each call, and shows its own dialog before adding anything. |
| `network` | Internet access: sockets and DNS | The sandbox. Loopback connections the plugin itself sets up (such as asyncio's internal socket pair) are allowed without it. |
| `subprocess` | Starting programs and signalling processes | The sandbox. |
| `filesystem` | Files outside the plugin's own folders, and registry writes | The sandbox. Without it, a plugin can read its own folder (including `.deps`) and the Python install, and it can read and write its data folder and its temp folder. |
| `native` | ctypes: loading libraries and calling foreign functions | The sandbox. Compiled wheels in `.deps` (numpy, onnxruntime…) import without it. |
| `microphone`, `clipboard` | Shown to the user | Declared only. They can't be enforced from Python. |

Things that need no permission:
- Your own `storage`, `settings` and data folder.
- `app.notify`, `app.log`, `app.open_url` and global shortcuts.
- All of `ui`.
- Talking to your `dependencies`.

**How it's enforced:**
- The plugin process starts with `-I` and a minimal environment. No secrets are inherited, and `HOME`, `APPDATA` and `TEMP` point into its data folder unless it has `filesystem`.
- Before your module is imported, a [`sys.addaudithook`](https://docs.python.org/3/library/sys.html#sys.addaudithook) hook is installed. It can't be removed, and it raises `PermissionError` for anything that wasn't granted.
- The error message names the permission that's missing. The attempt is logged and flagged on the plugin's page, so users and authors can see why something failed.

**What it doesn't do:** this is a policy layer, not an operating-system sandbox. It keeps honest plugins honest, stops accidents, and makes a plugin's reach visible. Native code runs outside it, which is why `native` is marked high risk: a C extension or a ctypes call can do anything the user can.

Plugins written for SDK 1.0 (no `permissions` field) still load. They are shown as **Full access (older plugin)** and run without the sandbox, once the user accepts that.

Check permissions at runtime with `llamarun.permissions.has("network")`, since the user may have turned one off.

## Lifecycle and events

| Hook | When | Return |
|---|---|---|
| `on_load(self)` | After the plugin is imported and instantiated | – |
| `on_unload(self)` | App quit, plugin reload, disable, removal, or a permission change | – |
| `on_before_text_generation(self, ctx)` | Before the prompt goes to the model (needs `hooks`) | `TextGenerationContext` or `None` |
| `on_after_text_generation(self, result)` | After the model has finished (needs `hooks`) | `TextGenerationResult` or `None` |

```python
@dataclass
class TextGenerationContext:
    input_text: str
    model: str
    cancel: bool = False

@dataclass
class TextGenerationResult:
    input_text: str
    response_text: str
    model: str
```

Hooks fire once per chat turn, in both the overlay and the chat window. `ctx.input_text` is the newest user message; the earlier conversation is sent to the model automatically. If you rewrite `input_text`, the chat shows the user's original text with a "Rewritten by a plugin" marker. The rewritten text is what the model sees, now and in later turns.

Pipeline rules:

- Plugins run in a fixed order: dependencies first, then sorted by `entry.module`.
- Each plugin receives the value returned by the previous plugin, so edits chain.
- Returning a context with `cancel=True` stops generation immediately, and later plugins are not called. The chat shows "Cancelled by <plugin name>".
- If a hook raises, the error is logged, the plugin is skipped, and the previous value is carried forward.
- If `on_after_text_generation` changes `response_text`, the chat replaces the streamed response with your version.
- Hooks run on a background thread, so blocking calls (even dialogs) are fine. Each hook has a 120-second budget before the app continues without it. A plugin that then doesn't answer a ping is restarted.

Any thread your plugin starts acts on its behalf, because each plugin has its own process. `self.start_thread(fn)` still works but is no longer required.

## UI

LlamaRun draws plugin UI with its own components, so it matches the app in light and dark mode and uses the Windows accent colour. Your plugin keeps the state and gets the events. No GUI toolkit is needed; the bundled Python doesn't even ship tkinter.

### Settings page

Declare your settings form in `on_load`. It appears on your plugin's page in **Settings → Plugins**. LlamaRun saves the values in `PluginData/<module>/settings.json`, so they survive updates and reinstalls.

```python
from llamarun import settings, ui

class Jarvis(llamarun.Plugin):
    def on_load(self):
        ui.settings(
            ui.Heading("Voice", level=3),
            ui.Select("voice", "Voice", options=list_voices()),        # list, (value, label) pairs, or dict
            ui.Slider("rate", "Speed", default=0, min=-10, max=10),
            ui.Switch("sounds", "Play chimes", default=True, description="When listening starts and stops."),
        )

    @settings.on_change
    def settings_changed(self, changed):          # {"rate": 3}
        ...

    def speak(self):
        rate = settings.get("rate")
```

`settings.get(name, default=None)`, `settings.all()` and `settings.set(name, value)` read and write values; a value you set shows up on the page straight away. Call `ui.settings(...)` again whenever the choices change. Fields: `Input`, `Textarea`, `Switch`, `Checkbox`, `Select`, `Slider`. Use `Heading`, `Text` and `Separator` to group them.

### Status card (HUD)

A small floating card at the bottom (or top) of the screen that never takes keyboard focus. It suits "listening / thinking / done" status.

```python
hud = ui.hud("Listening…", "Say something", indicator="pulse")
hud.update(level=0.6)                     # 0–1; throttled to ~30/s, so call it per audio frame
hud.update(title="Thinking…", indicator="spinner")
hud.hide(after=3)                         # or hud.hide(), hud.show(...), hud.close()
```

The indicators are `spinner`, `pulse` (its ring follows `level`), `bars` (speaking), `dot` (ready), `error` and `none`. Other options are `position="top"`, `on_click=callable` (without it, a click hides the card) and `show=False`.

### Toasts and dialogs

```python
ui.toast("Saved", kind="success", description="3 notes")        # info | success | warning | error

if ui.confirm("Delete all notes?", confirm_label="Delete", destructive=True): ...
name = ui.prompt("Name?", placeholder="Ada")                     # str or None
voice = ui.select("Voice", ["George", "Zira"])                   # value or None
values = ui.form("New reminder", ui.Input("what", "What"), ui.Slider("mins", "In (minutes)", default=10, max=120))
ui.alert("Done", "Everything is set up.")
```

Dialogs block the calling thread until the user answers. That's fine in hooks, actions and your own threads. They return `False`/`None` if the user dismisses them.

### Panels built in Python

A panel is a window. Build it from a `View`: `render()` returns a tree, and `set_state()` re-renders it.

```python
class Counter(ui.View):
    def __init__(self):
        super().__init__(count=0)

    def render(self):
        return ui.Column(
            ui.Heading(f"Clicked {self.state['count']} times"),
            ui.Row(
                ui.Input("step", "Step", default="1"),
                ui.Button("Add", on_click=self.add, icon="plus"),
            ),
        )

    def add(self, values):                 # values of the panel's inputs, by name
        self.set_state(count=self.state["count"] + int(values["step"]))

panel = ui.panel("Counter", view=Counter(), width=420, height=400)
panel.show()                               # also panel.close(), panel.set_title(), @panel.on_close
```

Components:

| Kind | Components |
|---|---|
| Layout | `Column(gap=)`, `Row(gap=, align=, justify=, wrap=)`, `Card(title=, description=)`, `Separator` |
| Text | `Heading(level=)`, `Text(tone=, size=, weight=)`, `Markdown`, `Code(language=)`, `Callout(title=, tone=)` |
| Display | `Badge(variant=)`, `Progress(value | None)`, `Spinner(label=)`, `List(items)`, `Image(src)` (use `ui.image_file("icon.png")` for your own files) |
| Inputs | `Input`, `Textarea`, `Switch`, `Checkbox`, `Select`, `Slider`, all with `name`, `label`, `default`, `description`, `on_change` |
| Actions | `Button(label, on_click, variant=, size=, icon=, disabled=)`. `icon` is a Lucide name such as `"trash-2"`. |

Handlers can take fewer arguments than they're given. `on_click` gets the input values, and `on_change`/`on_submit` get the new value. Changing a field's `default` between renders sets the field to that value.

### TSX panels

For anything the Python components don't cover, write the panel in TSX and keep the logic in Python:

```json
"ui": { "panels": { "Notes": "ui/Notes.tsx" } }
```

```tsx
// ui/Notes.tsx
import { Button, Card, Icon, Input } from '@llamarun/ui'
import { call, emit, usePluginState } from '@llamarun/plugin'

export default function Notes() {
  const { notes = [] } = usePluginState<{ notes: string[] }>()
  return (
    <div className="flex flex-col gap-2 p-4">
      {notes.map((n, i) => <Card key={i} className="px-4 py-2">{n}</Card>)}
      <Button onClick={() => emit('add', 'Another note')}><Icon name="plus" /> Add</Button>
    </div>
  )
}
```

```python
panel = ui.panel("Notes", tsx="Notes", state={"notes": []})
panel.on("add", lambda text: panel.set_state(notes=panel.state["notes"] + [text]))
panel.on("summarize", lambda _: llm.generate("…"))       # call('summarize') resolves with this
panel.show()
```

- `@llamarun/ui` is the app's own component set: `Button`, `Card*`, `Input`, `Textarea`, `Select*`, `Switch`, `Checkbox`, `Slider`, `Tabs*`, `DropdownMenu*`, `Popover*`, `Tooltip*`, `Badge`, `Separator`, `Skeleton`, `ScrollArea`, `Label`, `Markdown`, `Icon` (every Lucide icon), `icons` and `cn`.
- `@llamarun/plugin` covers the connection to Python:
  - `usePluginState()` returns the state from `panel.set_state` and re-renders when it changes.
  - `emit(event, payload)` sends an event without waiting.
  - `call(event, payload)` returns a promise of the handler's return value.
  - It also provides `close()`, `setTitle()` and `usePanel()`.
- You can import `react` and files in your plugin folder, nothing else. Tailwind classes work: LlamaRun generates the ones your panel uses, against the app's theme.
- LlamaRun compiles panels itself (with esbuild) when they open, and caches the result. There is no build step and nothing to install. For editor autocomplete, map the two modules to the type definitions in [`sdk/ts`](../sdk/ts). The ui_showcase example includes a `tsconfig.json`.
- **Panels are sandboxed.** They run in a separate browser session with no network access (CSP plus a request filter), no Node.js, and no access to the app's API. They can only talk to their own plugin, through the bridge above, and LlamaRun checks every message.

## Working with other plugins

Plugins can't import each other, because each runs in its own process. They work together through the app, and only with plugins they declare under `dependencies`. That declaration is the permission, and it also makes dependencies load (and hook) first. A missing or too-old dependency shows on the plugin's card.

### Services

```python
# provider (module "ui_showcase")
class Showcase(llamarun.Plugin):
    @llamarun.expose                      # or @llamarun.expose(name="add")
    def add_note(self, text: str) -> int: ...

# consumer, with "dependencies": {"ui_showcase": ">=1.0"}
count = llamarun.plugins.get("ui_showcase").add_note("from another plugin")
llamarun.plugins.available()              # your dependencies, whether they run, and what they expose
```

Arguments and return values must be JSON-serialisable. Errors come back as `PluginError`, and calls time out after 60 s (`plugins.get(module, timeout=…)`).

### Events

```python
llamarun.events.publish("note_added", {"text": text})      # delivered as "ui_showcase.note_added"

class Listener(llamarun.Plugin):
    @llamarun.events.subscribe("ui_showcase.*")
    def on_showcase(self, data, event):                    # event.topic, event.source
        ...

off = llamarun.events.on("ui_showcase.note_added", handler)   # at runtime; off() unsubscribes
```

### Shared state

Each plugin owns a key/value namespace named after its module. It lives in the app and is saved to `PluginData/_shared/<module>.json`. The owner can always write to it. Dependents can read it, and they can write if the owner lists them in `"shared": {"writers": [...]}` (or `["*"]`).

```python
stats = llamarun.shared.namespace("stats")               # your own namespace if omitted
stats.get("prompts", 0)
stats.update("prompts", lambda n: (n or 0) + 1)          # atomic across plugins (compare-and-set with retries)
stats.set("last", "hi", if_version=3)                    # raises shared.ConflictError if it changed
stats.watch("prompts", lambda value, key: ...)           # called when anyone changes it
```

`storage` is the plugin's private store, and nobody else can read it.

## API

### `llamarun.app`

```python
app.get_version() -> str
app.get_data_dir() -> Path                         # PluginData/<module>, survives updates
app.notify(title: str, message: str) -> None       # OS notification
app.log(level: "debug"|"info"|"warning"|"error", message: str) -> None
app.open_url(url: str) -> None                     # http(s)/mailto in the browser
app.open_path(path) -> None                        # with the default app; data folder only without "filesystem"
app.add_shortcut(accelerator: str, callback, *, id: str = "") -> None   # SDK 1.2
app.remove_shortcut(id: str) -> None
```

`add_shortcut` registers a global shortcut, such as `"CommandOrControl+Alt+Space"` (Electron's [accelerator syntax](https://www.electronjs.org/docs/latest/api/accelerator)). `callback()` runs on a worker thread whenever it's pressed, even when LlamaRun isn't focused. Adding the same `id` again replaces the shortcut, which suits one the user picks in settings. It raises `PluginError` if the shortcut is invalid or already taken, including by LlamaRun's own overlay shortcut. Shortcuts are removed when the plugin stops. Global shortcuts take the key combination away from every other app, so let users change or turn off yours.

Log lines go to `PluginData/<module>/debug.log` (rotated at 1 MB) and to the app's `logs/plugins.log`. `debug` lines are only written in development builds.

### `llamarun.llm` (needs `llm`)

```python
llm.get_selected_model() -> str
llm.get_available_models() -> list[str]                # cloud models + local Ollama models
llm.generate(prompt: str, *, model: str | None = None) -> str
```

`generate` runs **headlessly**: nothing appears in a chat, and plugin hooks are *not* fired, so it's safe to call from inside a hook.

### `llamarun.chats` (needs `chats`)

SDK 1.2. Sends a message as if the user typed it, and waits for the reply. The turn goes through the whole chat pipeline:
- the chat's history;
- the user's MCP tools, if the plugin also has `mcp`;
- other plugins' hooks;
- the tool-call limit, which can be continued.

It shows up live in the chat window, with the message marked as sent by your plugin.

```python
chats.send(text, *, chat_id=None, model=None, instructions=None, tools=True, save=True, voice=False,
           on_token=None, on_tool=None, on_start=None) -> ChatReply
chats.continue_(chat_id, *, on_token=None, on_tool=None) -> ChatReply   # after reply.paused
chats.cancel(chat_id) -> None
chats.list() -> list[ChatSummary]       # saved chats, newest first
chats.get(chat_id) -> dict | None       # the chat with its messages
chats.open(chat_id) -> None             # show it in the chat window
```

- `chat_id=None` starts a new chat; pass `reply.chat_id` to continue it.
- `instructions` apply to this reply only. They aren't shown in the chat or kept in its history, so the conversation still reads naturally when the user carries on typing. Use them for things like "your answer is read aloud".
- `save=False` keeps a new chat in memory only: it's never listed or written to disk, but follow-ups with its id still work while the plugin runs.
- `voice=True` shows the message as spoken (a microphone label) rather than sent.
- The reply streams to `on_token`. `on_tool` gets a `ToolUse(name, server)` for each MCP tool call. `on_start(chat_id)` fires as soon as the chat exists, so you can open or cancel it while the reply is still coming. Callbacks run on a worker thread, in order.
- `ChatReply` has `chat_id`, `message_id`, `text`, `status` (`"done"`, `"error"` or `"cancelled"`), `error`, `model`, `tools` and `paused`.
  - Model errors come back as `status == "error"` rather than an exception.
  - `paused` means the model reached the tool-call limit. `continue_` runs the tool calls it had asked for and carries on without repeating anything.

`send` blocks until the reply is finished, so call it from a worker thread. `cancel` is how another thread stops it early.

```python
from llamarun import chats

reply = chats.send("Summarise my unread email", on_token=lambda t: print(t, end=""))
if reply.paused:
    reply = chats.continue_(reply.chat_id)
chats.open(reply.chat_id)
```

### `llamarun.storage`

Private JSON key/value store at `PluginData/<module>/storage.json`. It's outside the plugin folder, so it survives updates.

```python
storage.get(key, default=None)
storage.set(key, value)      # value must be JSON-serialisable
storage.delete(key)
storage.clear()
```

### `llamarun.mcp` (needs `mcp`)

```python
mcp.list_tools() -> list[McpToolInfo]      # name, description, server, input_schema
mcp.call_tool(tool_name: str, arguments: dict) -> dict   # {"content": [...], "isError": bool}
```

### Tools for your models (needs `tools`)

SDK 1.3. Mark methods with `@llamarun.tool` and every chat model can call them, alongside the user's MCP tools:

```python
class DiceRoller(llamarun.Plugin):
    @llamarun.tool
    def roll_dice(self, sides: int = 6, count: int = 1) -> dict:
        """Roll dice.

        Args:
            sides: Faces on each die.
            count: How many dice, 1 to 100.
        """
        if not 1 <= count <= 100:
            raise llamarun.ToolError("Roll between 1 and 100 dice.")
        rolls = [random.randint(1, sides) for _ in range(count)]
        return {"rolls": rolls, "total": sum(rolls)}
```

- The description is the docstring's first paragraph, and parameter descriptions come from its `Args:` section. The input schema comes from the type hints: `str`, `int`, `float`, `bool`, `list[...]`, `dict`, `Optional[...]` and `Literal[...]`. Parameters without a default are required.
- `@llamarun.tool(name=..., description=..., parameters={...JSON Schema...})` overrides any of them. Names are 1 to 64 letters, digits, `_` or `-`.
- A returned string goes to the model as is; anything else as JSON. Raise `llamarun.ToolError(message)` to report a failure the model should explain. Other exceptions are reported to the model and logged.
- Tools run on the plugin's worker threads with its own permissions. They can block, for example on a dialog, for up to 15 minutes.
- In chats, tools show the plugin's name like an MCP server's. A tool whose name an MCP tool, or a plugin earlier in load order, already uses is not offered; a warning is logged.
- Turns sent with `chats.send` include plugin tools only if the sending plugin has `mcp`, as for MCP tools.

### Installing MCP servers and plugins (needs `install`)

SDK 1.3. Adding a server or installing a plugin always shows a Llama Run dialog listing exactly what will run or which permissions are asked for. The plugin only supplies a `reason`. The calls block until the user answers and return `None` if they decline.

```python
mcp.search_directory(query="", cursor=None) -> DirectoryPage   # .servers, .next_cursor (also with "mcp")
mcp.get_directory_server(server_id) -> DirectoryServer         # name, description, config {command, args, url, env}, installed…
mcp.list_servers() -> list[McpServer]                          # name, state, tool_count, error (also with "mcp")
mcp.add_server(name=None, *, directory_id=None, command=None, args=None, env=None, url=None, reason="") -> McpServer | None

plugins.installed() -> list[InstalledPlugin]                   # id, name, module, state, error, tools, granted
plugins.install(folder, *, reason="") -> InstalledPlugin | None
plugins.search_marketplace(query) -> MarketplaceResults         # available=False until the marketplace opens
```

- `add_server` lets the user type the server's environment variables (API keys) into the dialog, so plugins and models never see them. It returns once the server has tried to connect; check `state` and `error`. New MCP tools reach the model from the next message.
- `install` takes a folder inside your data folder, unless you also have `filesystem`. A folder with the same name as an installed plugin updates it, and the dialog says so. Dev-linked plugins and your own plugin can't be replaced. Only the installed plugin is started; other plugins keep running.

### Also

`llamarun.ui`, `llamarun.settings`, `llamarun.plugins` / `llamarun.expose`, `llamarun.events`, `llamarun.shared` and `llamarun.permissions` are described in the sections above.

### Errors

Every host call raises `llamarun.PluginError` on failure, for example an unknown MCP tool, no network, or a missing permission. The sandbox raises `PermissionError`.

## Dependencies

If your plugin folder contains `requirements.txt`, LlamaRun installs it into `<plugin>/.deps/` at install time with the bundled pip, and adds that folder to `sys.path`. Only **prebuilt wheels** are accepted (`--only-binary=:all:`), so installing a plugin never runs a package's build scripts. Use packages that publish wheels for CPython 3.13 on the user's platform. Native wheels import without the `native` permission; `native` is only needed for ctypes.

## Development workflow

- **Link instead of install:** **Install from Disk → Link folder for development** runs the plugin from your source folder.
  - Saving a `.py` file or `plugin.json` restarts just that plugin.
  - Saving a `.tsx`/`.ts`/`.css` file recompiles open panels and reloads them.
  - Removing a linked plugin only unlinks it; your folder is left alone.
- **Autocomplete:**
  - For Python, run `pip install -e sdk/python` in your editor's environment. The package ships `py.typed`.
  - For TSX, see [`sdk/ts`](../sdk/ts).
- **Unit tests without the app:** `import llamarun` works outside LlamaRun.
  - `storage` writes to `./.llamarun_data/<name>/`.
  - `settings` uses the declared defaults.
  - UI calls and host calls raise `PluginError`, unless you install a fake transport:

  ```python
  from llamarun import _rpc
  _rpc.set_transport(lambda method, params: {"llm.generate": "fake"}.get(method),
                     lambda method, params: print("notify", method, params))
  ```

- **Seeing what went wrong:**
  - The plugin's page shows load errors, crashes, and permissions the sandbox refused.
  - In development builds (`npm run dev`), tracebacks go in full to `debug.log` and the terminal. An exception in a UI callback also shows as a toast.

## Migrating from SDK 1.0

1. Set `"sdk_version": "1.1"` (`"1.2"` to use `chats` and shortcuts, `"1.3"` for tools and installing) and list `"permissions"`. Run the plugin, then add whatever the sandbox reports as blocked.
2. Replace tkinter windows with `ui.hud`, `ui.panel` or the dialogs. Replace config files you asked users to edit with `ui.settings`, and import the old file once in `on_load`.
3. Plugins no longer share a process. To call another plugin, list it under `dependencies` and use `plugins.get()`, events or shared state instead of module globals.
4. `start_thread` is optional now, and `app.get_data_dir()` is always available.

Plugins that aren't migrated keep working as "Full access" plugins, each in its own process.

## How it works

For each enabled plugin, the app starts `python -I -X utf8 -B -u plugin_host.py --plugin <folder> --data <PluginData/module> --grants …` with the bundled interpreter. The processes talk to the app with newline-delimited JSON-RPC 2.0 over stdin/stdout:

- The app calls `plugin.load`, `events.before_text_generation`, `ui.event`, `services.call`, `settings.changed`, and so on.
- Plugin code calls the app for `llm.*`, `mcp.*`, `app.*`, `ui.dialog`, `settings.*`, `services.*` and `shared.*`.
- UI updates are notifications: `ui.hud`, `ui.toast`, `ui.panel.open`, `ui.render` and `ui.state`.

`print()` output goes to stderr and ends up in `plugins.log`. The main process routes everything between plugins and checks every call against the caller's grants and dependencies.

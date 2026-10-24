# Llama Run

An AI assistant that is always one shortcut away. Press **Ctrl+Shift+A** anywhere to ask a question. Answers stream in as Markdown from local **Ollama** models or cloud models (Gemini, OpenAI) through your LlamaRun account. You can extend it with **MCP servers** and **Python plugins**.

This is the Electron + React + shadcn/ui version of the original C#/WinUI app. It bundles its own Python, so plugins work on machines without Python installed.

## Features

- **Overlay:** frameless, always-on-top acrylic window that works as a quick chat.
  - Toggle it with the global shortcut, which is configurable. If the default is taken it falls back to Ctrl+Shift+S.
  - Follow-up questions continue the same thread. Reopening the overlay continues it until it has been idle for the time set in Settings (30 minutes by default). Ctrl+N starts a new chat, and an empty overlay lists recent chats.
  - The "Open in Chats" button moves the thread into the full chat window.
  - It hides when it loses focus. Esc stops a generation or hides the window.
  - Responses render as streaming Markdown with code highlighting.
  - An animated gradient plays while the model is generating.
- **Chat window:** full multi-turn chat with a saved history sidebar (grouped by date, searchable, rename and delete), a model picker for each chat, copy and regenerate buttons, and inline errors with Retry. Open it from the tray, the overlay or Settings.
- **Design:** layout and tokens follow [T3 Code](https://github.com/pingdotgg/t3code). On Windows 11 a Fluent layer adds Mica/Acrylic backdrops, Segoe UI Variable, native caption buttons and your Windows accent colour. On older Windows versions and other platforms the opaque T3 palette is used.
- **Models:** Ollama (`127.0.0.1:11434`, or set `OLLAMA_HOST`) and cloud models through the LlamaRun server. Sign-in uses the `llama-run://` deep link.
- **MCP:**
  - Browse the MCP directory, review the JSON config, and install servers.
  - Connections are cached. Both STDIO and URL (Streamable HTTP/SSE) servers are supported.
  - Tool calling works for cloud models and for Ollama models that support tools.
- **Python plugins:**
  - Plugins use the `llamarun` SDK: chat hooks, `chats` (talk to your models in your chats, with MCP tools, streaming the reply), `llm`, `mcp`, `storage`, global shortcuts and notifications. Plugins can also give your models new tools (`@llamarun.tool`), and ask to add MCP servers or install plugins, which you confirm.
  - **UI:** plugins can have a settings page, floating status cards, dialogs, toasts, and panels. Panels can be built in Python or written in TSX. The app draws all of it with its own components, so plugins need no GUI toolkit.
  - **Sandbox:** each plugin runs in its own auto-restarting process on the bundled CPython 3.13, with only the permissions the user approved at install (internet, files, programs, native code, models, MCP, chat messages). An audit-hook sandbox enforces them, and TSX panels run with no network or app access.
  - **Cooperation:** plugins work together through declared dependencies, exposed services, events and shared state.
  - `requirements.txt` is installed with pip, prebuilt wheels only.
  - "Link folder for development" hot-reloads a plugin from its source folder.
- **Other:** tray icon (left-click opens Settings, right-click opens a menu with Quit), launch at login, onboarding, single instance.

## Development

Requirements: Node 20+ and Git.

```bash
npm install          # also downloads the bundled CPython into resources/python/
```

```bash
npm run dev          # run with hot reload
```

```bash
npm test             # main-process unit tests (vitest)
```

```bash
npm run test:sdk     # Python SDK tests, run with the bundled interpreter
```

```bash
npm run build:win    # NSIS installer in dist/
```

Useful environment variables:

| Variable | Purpose |
|---|---|
| `LLAMARUN_USER_DATA` | Use a separate profile directory, e.g. `./.devdata` |
| `LLAMARUN_SERVER_URL` | LlamaRun backend. Default: `https://llamarun.krishbaidya.me` |
| `LLAMARUN_MCP_DIRECTORY_URL` | MCP directory. Default: `https://mcp.krishbaidya.me` |
| `OLLAMA_HOST` | Ollama endpoint |
| `LLAMARUN_PYTHON` | Use another interpreter if the bundled one is missing |
| `LLAMARUN_SKIP_PYTHON=1` | Skip the Python download during `npm install` |

## Project layout

```
src/main/        Electron main process: windows, tray, hotkey, settings, auth
  llm/           Ollama + cloud proxy (headless generate())
  mcp/           mcp.json, client manager, directory API
  plugins/       per-plugin Python processes, permissions, broker, installer
    ui/          plugin UI: HUD, dialogs, sandboxed panels, TSX compiler
src/preload/     typed contextBridge API (window.llamarun)
src/shared/      IPC contract and shared types
src/main/chats/   chat store + ChatService (plugin hooks -> model -> hooks, per chat)
src/renderer/    React + shadcn/ui: overlay, chat window, settings, onboarding,
                 plugin HUD/dialog/panel pages (plugin-kit/ renders Python UI trees)
sdk/python/      llamarun SDK package + plugin_host.py runner (one plugin per process)
sdk/ts/          type definitions for TSX panels (@llamarun/ui, @llamarun/plugin)
examples/plugins/prompt_logger/   chat hooks + settings
examples/plugins/ui_showcase/     every kind of plugin UI, plus a service
scripts/         fetch-python.mjs (bundled CPython), test-sdk.mjs
```

## Data locations

These live in the Electron `userData` folder (`%APPDATA%\llamarun` on Windows):

- `config.json`: settings
- `auth.json`: account profile. The token is encrypted with the OS keychain via `safeStorage`.
- `mcp.json`: MCP servers, in the same format as the WinUI app
- `chats/<id>.json`: saved chats, one file each
- `Plugins/<id>/`: installed plugins
- `PluginData/<module>/`: plugin `storage.json`, `settings.json`, `debug.log`, and the plugin's own files
- `PluginData/_shared/<module>.json`: state shared between plugins
- `PluginUi/<id>/`: compiled TSX panels (a cache)
- `logs/`: `plugins.log` and `crash.log`

## Writing plugins

See [docs/plugin-sdk.md](docs/plugin-sdk.md).

## License

GPL-3.0

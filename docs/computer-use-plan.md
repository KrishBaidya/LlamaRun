# Computer use with Cua Driver: implementation plan

Goal: Llama Run can operate the user's Windows PC on its own (open apps, click, type, fill forms, drive Edge/Chrome), as fast as possible, with the user in control.

Upstream: [Cua Driver docs](https://cua.ai/docs/cua-driver), source in [trycua/cua](https://github.com/trycua/cua) (`libs/cua-driver`).

## 1. Decision: use the SDK, don't build a toolchain

Three ways in were considered:

| Option | What it is | Verdict |
|---|---|---|
| A. MCP server | Register `cua-driver mcp` as a STDIO server in the existing MCP manager | Works today with no code, but slow and clumsy: a JSON-RPC hop per action, all 67 tools in every request, screenshots thrown away (see §3). Keep it only as phase 0 / fallback. |
| **B. Native SDK (recommended)** | `@trycua/cua-driver` (npm, MIT) loaded in a dedicated Electron utility process, wrapped as Llama Run built-in tools | Fastest path: no extra executable on Windows (`create()` runs the runtime in-process), one warm driver for the app's lifetime, our own small tool surface, and full control over what goes back to the model. |
| C. Own toolchain | Write our own UI Automation + window-message + CDP driver in Rust/C# | Rejected. Cua already does UIA Invoke, background window-message input that doesn't steal focus, per-agent cursor overlay, CDP browser control, stale-element detection and action verification. Rebuilding that is months of work for no speed gain. |

Why B is the fast one:

- The SDK ships prebuilt native packages `@trycua/cua-driver-win32-x64-msvc` and `-win32-arm64-msvc` (optional dependencies, ~31 MB unpacked). On Windows there is no daemon, socket or `cua-driver.exe` to spawn; the runtime lives in our process.
- Calls between the main process and the utility process go over a `MessagePort` (sub-millisecond), versus spawn + stdio JSON-RPC for MCP.
- The element cache and browser (CDP) connections stay warm across turns because we keep one `CuaDriver` instance alive.
- We choose what the model sees: a compact tree, the newest screenshot only, and the result of an action plus the new state in one tool result (§4). Model round trips, not the driver, dominate end-to-end time, so this is where "lightning fast" is won.

Licensing: the SDK is MIT; the Windows native package is "MIT AND MPL-2.0". Both are compatible with Llama Run's GPL-3.0. Keep the upstream notices in the installer's third-party licenses.

## 2. Architecture

```
Chat turn (chats/service.ts)
  └─ chatTools() ── adds computer_* tools when Computer use is on
        └─ computer/tools.ts      curated tools, approvals, result shaping
              └─ computer/driver.ts   main-process client (request/response over MessagePort)
                    └─ utilityProcess: computer/worker.ts
                          └─ CuaDriver.create()  (@trycua/cua-driver, in-process runtime)
                                ├─ UI Automation (read tree, Invoke, set value)
                                ├─ window messages to the target HWND (background input)
                                └─ CDP (Edge / Chrome tabs)
```

Why a utility process and not the main process: a native crash or hang in the driver must not take down the overlay, chat windows, or tray. The worker is restarted on exit (like `plugins/process.ts` does for Python plugins), and every pending call rejects with a clear error instead of hanging.

### New files

| File | Responsibility |
|---|---|
| `src/main/computer/worker.ts` | Utility process entry. Owns one `CuaDriver` (`CuaDriver.create()`), answers `{id, tool, args}` messages with `ToolResult`s, calls `end_session` / `shutdown` on exit. |
| `src/main/computer/driver.ts` | Starts the worker lazily on first use, warms it (`health_report`) in the background once the setting is on, request ids, timeouts, restart on crash, `abort()` that ends the session. |
| `src/main/computer/tools.ts` | The ~12 tools the model sees, their compact schemas, approval checks, and the act-then-observe result (§4). |
| `src/main/computer/snapshot.ts` | Turns the accessibility tree into compact text with short ids, diffs it against the previous snapshot, prunes old snapshots from history. |
| `src/main/computer/policy.ts` | Per-chat app grants, always-ask tools, blocked apps, the stop hotkey. |
| `src/renderer/src/settings/pages/ComputerPage.tsx` | Settings: on/off, approval mode, blocked apps, show agent cursor, screenshot mode, step limit. |

### Files to change

| File | Change |
|---|---|
| `package.json` | Add `@trycua/cua-driver` (pin an exact version). |
| `electron-builder.yml` | `asarUnpack: node_modules/@trycua/**` so the native library loads from real files. Add an arm64 Windows target later. |
| `electron.vite.config.ts` | Add `computer/worker.ts` as a second main-process entry so it builds to `out/main/computerWorker.js`. `externalizeDepsPlugin` already keeps the package external. |
| `src/main/chats/service.ts` | `chatTools()` adds the computer tools when enabled; per-turn step cap for computer turns; abort ends the driver session. |
| `src/main/mcp/manager.ts` (`McpToolResult`) | Keep `image` content parts instead of only text. |
| `src/main/llm/toolPayload.ts` | New `toolResultParts()` that returns text plus at most one image; `toolResultToText` stays for models without vision. |
| `src/main/llm/ollama.ts`, `src/main/llm/cloud.ts` | Send tool-result images to vision models (§3). |
| `src/main/llm/types.ts` | `MAX_TOOL_ROUNDS` becomes per-generation (`maxToolRounds` option); keep 8 for normal chat. |
| `src/main/settings.ts`, `src/shared/types.ts` | `computerUse` settings. |
| `src/main/plugins/ui/hud.ts` | Reuse the HUD for a "Llama Run is using Notepad · Stop" pill while a computer turn runs. |
| `sdk/python/llamarun/` | Later: `llamarun.computer` for plugins behind a new `computer` permission. |

## 3. Gaps in Llama Run to close first

These block a good experience with any driver, MCP or SDK:

1. **Screenshots never reach the model.** `toolResultToText()` replaces image parts with `[image image/png]`. For vision models, pass the newest screenshot through: Ollama accepts `images` on messages; the cloud backend needs the tool-result `content` array to carry an `image` part (server change in the cloud service, which is not in this repo). Non-vision models get the text tree only, which is enough for most UIA-accessible apps.
2. **8 tool rounds is far too few.** A real task ("rename these 5 files in Explorer") takes 20–60 actions. Add `maxToolRounds` per generation: 8 for chat, a setting (default 50) for computer turns. Keep the existing pause/continue for when it's reached.
3. **Old observations bloat every request.** Every round resends all earlier tool results. Replace each superseded snapshot in history with a one-line stub (`[window state of Notepad, superseded]`) and keep only the latest full tree and latest image. This keeps request size flat instead of growing with every step, which is the biggest latency factor after step count.
4. **Tool list size.** Today every MCP tool goes out on every round. The computer tools are offered only when Computer use is on and the turn needs it (setting + a `/computer` command or an intent check like `wantsShell`), so normal chats stay as light as now.

## 4. The tool surface the model sees

Cua exposes 67 tools. Small local models choose badly from long lists and every tool costs tokens on every round, so we expose a curated set and map them onto the SDK:

| Llama Run tool | Cua calls | Notes |
|---|---|---|
| `computer_apps` | `list_apps`, `list_windows` | One call, merged and trimmed to visible windows. |
| `computer_open` | `launch_app` | Launches in the background, returns the new window's state. |
| `computer_look` | `get_window_state` | Compact tree; screenshot only if the model has vision and screenshots are on. |
| `computer_click` | `click` / `double_click` / `right_click` | Target by element id (preferred) or window-local x,y. |
| `computer_type` | `type_text`, `set_value` | `set_value` when the element supports it (instant, verified). |
| `computer_key` | `press_key`, `hotkey` | |
| `computer_scroll` | `scroll` | |
| `computer_drag` | `drag` | |
| `computer_steps` | `run_steps` | Several actions in one call, stops at the first failure. |
| `computer_menu` | `invoke_menu` | Menu path, e.g. `File > Save As…`. |
| `browser_open` / `browser_act` | `browser_prepare`, `browser_navigate`, `browser_click`, `browser_type`, `get_browser_state` | DOM-level control of Edge/Chrome over CDP: faster and more reliable than pixels. |
| `computer_clipboard` | `clipboard_read`, `clipboard_write` | Always asks before writing. |

Not exposed: recording, cursor theming, config, `kill_app`, `run_script` (arbitrary JS), `parse_visual_regions` (8–9 s per call on Windows; only used internally as a last resort when an app has no accessibility tree).

### Act-then-observe in one round

Every action tool returns, in the same result:

1. Cua's `effect` (`confirmed`, `suspected_noop`, `refused`…) and `verified` flag.
2. The window's new state as a **diff** against the previous snapshot (added, removed, changed elements), or the full compact tree if the diff is larger than the tree.

So the model never spends a round just to look after acting. That roughly halves the number of model calls per task.

### Compact tree format

```
Notepad — "notes.txt" [win 3]
  e1 MenuItem "File"   e2 MenuItem "Edit"   e3 MenuItem "View"
  e4 Document "Editor" value="Hello wor…" focused
  e5 Button "Close"
```

- Short ids (`e1`, `e2`) map to Cua's `element_token`s inside `snapshot.ts`; long tokens never go to the model.
- Only visible, interactive or labelled nodes; values cut to ~60 chars; depth limited.
- On `stale_element_token`, the tool re-snapshots and re-resolves the element by role + name once before reporting failure.

## 5. Speed budget

Target: a simple step (click a known button) in **under 1.5 s end to end with a fast cloud model**, of which the driver takes tens of milliseconds.

| Cost | How we keep it down |
|---|---|
| Driver start-up | Start the worker in the background when the setting is on; one `CuaDriver` for the app's lifetime. |
| Observation | UIA tree first (fast); screenshot only for vision models and only when asked or when the tree is thin; downscale and JPEG-encode before sending. Never use the visual parser on the hot path. |
| Action | Element actions (UIA Invoke / `set_value`) before pixel clicks; `browser_*` over CDP for web pages. |
| Model round trips | Act-then-observe in one result; `computer_steps` for batches; prompt the model to send several actions per turn when it is sure. |
| Request size | Superseded snapshots pruned; diffs instead of full trees; tool list only on computer turns. |
| Verification | Trust `verified: true` read-back; only re-look when `effect` is `suspected_noop` or `unverifiable`. |

Model guidance: computer use needs a model with good tool calling. Recommend a fast cloud model by default and a capable local one (e.g. a Qwen/Gemma tool-calling model) for private use; show the expected speed in the model picker.

## 6. Safety and control

Computer use acts with the user's own permissions, so it must be obviously visible and easy to stop:

- **Off by default.** Turned on in Settings → Computer use, with a one-time explanation.
- **Per-app grants.** The first action on an app asks "Allow Llama Run to control Notepad in this chat?" (allow once / for this chat / deny), using the existing `askApproval` card. Observing (listing windows, reading a tree) doesn't ask.
- **Always ask** for: typing into password fields, clipboard writes, downloads, file uploads, and anything in a blocked app.
- **Blocked apps** list (user-editable), empty by default with suggestions such as password managers and banking apps.
- **Stop at any time.** A HUD pill shows "Using Notepad · Stop"; a global hotkey stops the run. Stop aborts the chat's `AbortSignal`, cancels the pending action, and ends the Cua session.
- **Visible agent cursor** on by default, so the user sees where it acts. Background input means the user's own mouse and keyboard keep working.
- Elevated (admin) windows are refused by Windows UIPI; we surface Cua's refusal as "this window runs as administrator; Llama Run can't control it" rather than trying to elevate.
- Plugin-sent turns never get computer tools (same rule as the shell tools).

## 7. Phased delivery

| Phase | Scope | Exit criteria |
|---|---|---|
| 0. Try it | Add Cua Driver to the MCP directory (`cua-driver mcp`). No code. | Users can experiment; we learn which tools models use. |
| 1. Spike | Load `@trycua/cua-driver` in an Electron 44 utility process on Windows x64; `list_windows` + `get_window_state` + `click` on Calculator. Measure per-call latency. | Native package loads from the packaged, asar-unpacked app; latency numbers recorded. |
| 2. Core | `computer/*` modules, curated tools, compact tree + diff, act-then-observe, per-turn step cap, history pruning, approvals, HUD + stop. | Calculator, Notepad and Settings tasks pass the eval set (§8) with text-only models. |
| 3. Vision | Image parts in tool results for Ollama and cloud (needs the cloud server change). Screenshot mode setting. | A canvas-style app task (no accessibility tree) passes with a vision model. |
| 4. Browser | `browser_*` tools over CDP for Edge/Chrome. | Web form fill and multi-tab tasks pass. |
| 5. Polish | Settings page, model guidance, arm64 build, Python SDK `llamarun.computer`, docs. | Release notes and README section. |

## 8. Testing

- **Unit (vitest, any OS):** `snapshot.ts` compaction and diff, history pruning, id ↔ token mapping, policy decisions, tool-result shaping. The driver is mocked behind the `driver.ts` interface.
- **Windows integration (CI, `windows-latest`):** load the native package in Electron, run `health_report`, open Notepad, type, read back. Marked optional if the runner has no interactive desktop.
- **Eval set (manual, per release):** ~15 scripted tasks (Calculator sum, Notepad write and save, toggle dark mode in Settings, rename files in Explorer, fill a web form in Edge…), recording success, steps and wall time per model. Regressions in step count or time block a release.

## 9. Open questions

1. Does the uniffi-based Node binding load cleanly in Electron 44's main/utility process (Node ABI, `@ubjs/node`)? Phase 1 answers this; if not, fall back to the MCP route behind the same `driver.ts` interface (spawn `cua-driver mcp`, keep the curated tools and result shaping).
2. Cloud backend: does the Llama Run server forward image parts in tool results to the provider? Needs a server change for phase 3.
3. Should computer use be a Pro feature for cloud models, given the higher token use per task?

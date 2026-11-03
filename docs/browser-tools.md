# Computer use: web pages through the browser

Phase 4 of [computer-use-plan.md](computer-use-plan.md). Web pages in Edge and Chrome are read and acted on through Cua Driver's browser tools (CDP), bound to the exact window, instead of the window's accessibility tree. The accessibility route struggled in real chats: a Coursera assignment's text was hard to read, Chromium refused background scrolls, and a 226-tab Edge window filled the read budget with tab rows.

Checked against the Cua docs ([browsers](https://cua.ai/docs/cua-driver/guides/browsers), [browser tool reference](https://cua.ai/docs/cua-driver/reference/mcp-tools/pointer-cursor-and-browser), [permissions](https://cua.ai/docs/cua-driver/guides/permissions), [SDK](https://cua.ai/docs/cua-driver/guides/use-the-sdk)), the full `BROWSER.md` embedded in `@trycua/cua-driver` 0.38.0, and probes of the real driver on Windows.

## Decisions (answered by the user)

| Question | Decision |
|---|---|
| Which browser profile | **The user's signed-in Edge/Chrome, approved in a card.** The worker starts the driver with `CuaDriver.createConfiguredWithAuthorizationHost` (standard mode). When `browser_prepare` needs the existing-profile grant, the driver calls the host; the worker forwards the request to the main process, which shows the driver's own `humanSummary` in the chat's approval card. Allow or deny goes back as the decision for that request's digest. No "always": the SDK forbids an auto-accepting host. Allowing it also counts as allowing the browser app for the reply. No isolated profile. |
| Tool surface | **Two new tools.** `computer_page` reads the page (outline and refs; `find`, `within`, `more`, `tab`). `computer_page_act` does click, double_click, right_click, hover, type, select, scroll, drag, navigate, upload, accept_dialog and dismiss_dialog by ref. `computer_*` stays for browser chrome (tabs, address bar) and native apps. |
| Session lifetime | **One reply.** Browser targets, tabs, refs and the profile grant belong to the Cua session, which starts with the reply and ends with it (`end_session`). Each reply that uses the browser asks once. |

Rules kept from the SDK: delivery is explicit (background unless the model passes `foreground: true` after a refusal; never retried in the foreground automatically), and refs are used only from the latest snapshot of a tab (a stale ref is refused and the result carries a fresh read).

Also decided while building:

- Reads (`computer_page`) don't ask for the app, like `computer_look`, but blocked apps are refused. Acting asks as other actions do, unless the profile card already allowed the browser this reply.
- Uploading local files to a page asks every time and shows the paths. Typing into a password field asks every time.
- After a click, pointer action, navigation or dialog, the result carries the page read again (act and observe in one round, as with `run_steps`). Typing and selecting don't, so a form can be filled on the refs of one read; the driver reads the value back as evidence.
- Page reads are `superseded` by later ones, so only the newest page state stays in later requests.
- `submit` on type sends Enter as a keystroke on the same field (`browser_type` with `mode: "keystrokes"`, text `"\r"`): 0.38 has no browser key tool.
- No new system-prompt lines. The prompt line telling the model to type into web pages by x,y was trimmed to Electron apps.
- Not exposed: `browser_download`, coordinate clicks, `input_route: "dom_event"` and page screenshots.

## Found on the way

- **Session labels are retired by `end_session`.** The driver refuses a label after `end_session` (`session_ended`) until `start_session` declares it again. Llama Run reused `llamarun-<chatId>` without `start_session`, so the second reply in a chat failed. Each reply now starts with `start_session`.
- Refusals from `get_browser_state` and `browser_prepare` come back with `isError: false`: the code is in `errorCode` and `structured.status` is `"refused"`.
- On the development machine (Edge, Windows 11), `browser_prepare` with `existing_profile` refused with `browser_wrong_target_refused` ("the native tab strip did not expose one exact structural new-tab action") before asking the host, with no side effects. The driver couldn't turn on remote debugging itself. Llama Run then tells the user to turn on "Allow remote debugging for this browser instance" at `edge://inspect/#remote-debugging` (`chrome://inspect/#remote-debugging` in Chrome); with an endpoint already open, `browser_prepare` skips setup and goes to the approval card.
- An isolated profile (`isolated_new`) refused with `browser_endpoint_owner_mismatch` on the same machine.
- `launch_app` for "Microsoft Edge" goes through `shell:AppsFolder\MSEdge` and drops `additional_arguments`, so `computer_open` with app "Microsoft Edge" and a url opens a new tab page, not the url.

## Not verified live

The attach failed on the development machine and the user chose not to enable remote debugging by hand, so page output shaping follows the documented `semantic_v2` shape (`snapshot.outline`, `refs[].actions`, `content_refs`, `complete`, `omitted`, `continuation`) and falls back to the driver's own text. Enter by keystroke (`submit`) is untested. Both need a check in a browser with remote debugging on.

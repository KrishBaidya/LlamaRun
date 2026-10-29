import type { McpToolInfo } from '@shared/types'
import { askApproval } from '../assistant/approval'
import type { McpToolResult } from '../mcp/manager'
import { settings } from '../settings'
import { driver } from './driver'
import { indicator } from './indicator'
import type { DriverResult } from './protocol'

/**
 * Computer use: the model operates apps on the user's PC through Cua Driver
 * (https://cua.ai/docs/cua-driver). Instead of Cua's 60+ tools, the model gets
 * a small set built for speed:
 *
 * - Windows are named by their id and elements by their row number ([N]) in
 *   the window's latest snapshot; Cua's element tokens never reach the model.
 * - Every action returns what changed in the window (Cua's `since` diff), so
 *   the model doesn't spend a round just looking after it acts.
 * - Older window states are marked `superseded`, so the chat loop can drop
 *   them from later requests (see llm/toolPayload.ts).
 *
 * Input goes to the target window in the background: the user's own mouse and
 * keyboard keep working. Each app needs the user's OK once per reply.
 */

const SERVER = 'Computer use'
/** Long edge of screenshots sent to vision models: enough to read UI text, small enough to stay fast. */
const SCREENSHOT_EDGE = 1280
/** Elements read per snapshot; the model can narrow with `find` to see further. */
const MAX_ELEMENTS = 400
/** How long computer_open waits for the new app's window. */
const OPEN_WAIT_MS = 8000
const MAX_LIST_LINES = 60

export interface ComputerContext {
  chatId?: string
  /** Send screenshots back (the model can see images). */
  screenshots?: boolean
}

interface WindowInfo {
  pid: number
  windowId: number
  app: string
  title: string
}

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): McpToolInfo => ({
  name,
  server: SERVER,
  description,
  inputSchema: { type: 'object', properties, required }
})

const WINDOW = { type: 'integer', description: 'Window id from computer_windows.' }
const ELEMENT = { type: 'integer', description: 'Row number [N] from the window\'s latest state.' }
const X = { type: 'number', description: 'Window-local x in the screenshot, when there is no element.' }
const Y = { type: 'number', description: 'Window-local y in the screenshot.' }
const FOREGROUND = { type: 'boolean', description: 'Bring the window to the front first. Only after a background action was refused.' }

export const COMPUTER_TOOLS: McpToolInfo[] = [
  tool('computer_windows', 'List open windows: id, app and title.', { app: { type: 'string', description: 'Only windows of this app.' } }, []),
  tool('computer_apps', 'List installed apps that computer_open can start.', { find: { type: 'string', description: 'Only apps whose name contains this.' } }, []),
  tool(
    'computer_open',
    "Start an app (in the background) and return its window's state.",
    {
      app: { type: 'string', description: 'App name, e.g. "notepad", "calc", "msedge".' },
      args: { type: 'array', items: { type: 'string' }, description: 'Command-line arguments.' },
      url: { type: 'string', description: 'A URL or file to open with it.' }
    },
    ['app']
  ),
  tool(
    'computer_look',
    "Read a window: its elements as rows [N] role \"name\" (and a screenshot when you can see images). Use find to search a long window.",
    { window: WINDOW, find: { type: 'string', description: 'Only rows matching this text (plus their parents).' } },
    ['window']
  ),
  tool(
    'computer_click',
    'Click an element (preferred) or a point. Returns what changed.',
    {
      window: WINDOW,
      element: ELEMENT,
      x: X,
      y: Y,
      button: { type: 'string', enum: ['left', 'right', 'middle'] },
      clicks: { type: 'integer', description: '2 for a double-click.' },
      foreground: FOREGROUND
    },
    ['window']
  ),
  tool(
    'computer_type',
    'Type text into an element (or the focused one). replace sets the whole value instead of appending; submit presses Enter after.',
    { window: WINDOW, text: { type: 'string' }, element: ELEMENT, replace: { type: 'boolean' }, submit: { type: 'boolean' }, foreground: FOREGROUND },
    ['window', 'text']
  ),
  tool(
    'computer_key',
    'Press a key or shortcut in a window, e.g. "enter", "ctrl+s", "alt+f4".',
    { window: WINDOW, keys: { type: 'string' }, element: ELEMENT, foreground: FOREGROUND },
    ['window', 'keys']
  ),
  tool(
    'computer_scroll',
    'Scroll a window, an element or a point.',
    {
      window: WINDOW,
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
      amount: { type: 'integer', description: 'Steps, default 3.' },
      element: ELEMENT,
      x: X,
      y: Y,
      foreground: FOREGROUND
    },
    ['window', 'direction']
  ),
  tool(
    'computer_drag',
    'Drag between two window-local points.',
    { window: WINDOW, from_x: { type: 'number' }, from_y: { type: 'number' }, to_x: { type: 'number' }, to_y: { type: 'number' }, foreground: FOREGROUND },
    ['window', 'from_x', 'from_y', 'to_x', 'to_y']
  ),
  tool(
    'computer_menu',
    'Choose a menu item by its path, e.g. ["File", "Save As..."].',
    { window: WINDOW, path: { type: 'array', items: { type: 'string' } } },
    ['window', 'path']
  ),
  tool(
    'computer_steps',
    'Run several actions in one window in order, stopping at the first failure. Fastest way to do a known sequence (fill a form, then submit). Returns what changed.',
    {
      window: WINDOW,
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['click', 'type', 'key', 'scroll'] },
            element: ELEMENT,
            x: X,
            y: Y,
            text: { type: 'string', description: 'type: the text.' },
            replace: { type: 'boolean' },
            keys: { type: 'string', description: 'key: e.g. "tab", "ctrl+a".' },
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
            button: { type: 'string', enum: ['left', 'right', 'middle'] },
            clicks: { type: 'integer' }
          },
          required: ['action']
        }
      }
    },
    ['window', 'steps']
  )
]

const NAMES = new Set(COMPUTER_TOOLS.map((t) => t.name))

export function isComputerTool(name: string): boolean {
  return NAMES.has(name)
}

export function computerInstructions(): string {
  return [
    '## Using the computer',
    "You can operate apps on the user's Windows PC with the computer_* tools. Work like this:",
    '1. computer_windows to find the window (or computer_open to start the app), then computer_look to read it.',
    '2. Act on elements by their row number [N]: computer_click, computer_type, computer_key. Use x,y only for things without a row.',
    '3. Every action returns what changed, so you rarely need computer_look again. Row numbers refer to the latest state of that window.',
    '4. For several known actions in one window, use computer_steps: one call instead of many.',
    'Input goes to the window in the background; the user can keep working. Act without asking for each step, but stop and ask the user before anything hard to undo: sending messages or email, buying, deleting, or changing account or security settings.',
    'If an action is refused in the background, try it once with foreground: true. If an app shows no rows, it may not support accessibility; say so if you cannot continue.'
  ].join('\n')
}

// ------------------------------------------------------------------ helpers

const result = (text: string, isError = false): McpToolResult => ({ content: [{ type: 'text', text }], isError })

function int(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`"${key}" must be a number`)
  return Math.round(n)
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`"${key}" must be a number`)
  return n
}

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value) throw new Error(`"${key}" is required`)
  return value
}

/** "notepad.exe", "Notepad" -> "notepad": how app grants and blocks are matched. */
export function appKey(app: string): string {
  return app
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '')
}

const MODIFIERS = new Set(['ctrl', 'control', 'shift', 'alt', 'win', 'super', 'meta', 'cmd'])

/** "ctrl+shift+s" -> a hotkey; "enter" -> a single key. */
export function parseKeys(keys: string): { tool: 'press_key'; args: { key: string } } | { tool: 'hotkey'; args: { keys: string[] } } {
  const parts = keys
    .split('+')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .map((k) => (k === 'control' ? 'ctrl' : k === 'esc' ? 'escape' : k === 'return' ? 'enter' : k))
  if (!parts.length) throw new Error('"keys" is required')
  if (parts.length === 1 && !MODIFIERS.has(parts[0])) return { tool: 'press_key', args: { key: parts[0] } }
  return { tool: 'hotkey', args: { keys: parts } }
}

/** Cua's diff text names snapshot ids and element tokens; the model only needs rows. */
function cleanDiff(diff: string): string {
  return diff
    .split('\n')
    .filter((line) => !/element_token|Invalidated snapshots/i.test(line))
    .join('\n')
    .replace(/\s*;?\s*use snapshot_id \S+ in element_tokens \([^)]*\)\.?/gi, '.')
    .replace(/\bsince s[0-9a-f]{6,}\b/gi, 'since your last look')
    .trim()
}

/** Row number -> its line, from a window's full tree ("- [12] button "Save""). */
export function rowsOf(tree: string): Map<number, string> {
  const rows = new Map<number, string>()
  for (const line of tree.split('\n')) {
    const m = /\[(\d+)\]/.exec(line)
    if (m) rows.set(Number(m[1]), line.trim())
  }
  return rows
}

// ------------------------------------------------------------------ the tools

class Computer {
  private windows = new Map<number, WindowInfo>()
  /** Window id -> snapshot id of its latest state; row numbers refer to it. */
  private snapshots = new Map<number, string>()
  /** Window id -> its rows, from the latest full read. */
  private rows = new Map<number, Map<number, string>>()
  /** Chat id -> apps the user allowed for the current reply. */
  private grants = new Map<string, Set<string>>()

  tools(): McpToolInfo[] {
    return COMPUTER_TOOLS
  }

  /** The reply ended: its one-off app grants and the "using" card go. */
  endTurn(chatId: string): void {
    this.grants.delete(chatId)
    indicator.done(chatId)
  }

  async call(name: string, args: Record<string, unknown>, context: ComputerContext = {}): Promise<McpToolResult> {
    try {
      switch (name) {
        case 'computer_windows':
          return await this.listWindows(typeof args.app === 'string' ? args.app : undefined)
        case 'computer_apps':
          return await this.listApps(typeof args.find === 'string' ? args.find : undefined)
        case 'computer_open':
          return await this.open(args, context)
        case 'computer_look': {
          const win = await this.window(args)
          const state = await this.observe(win, context, { full: true, query: typeof args.find === 'string' ? args.find : undefined })
          return { content: [{ type: 'text', text: state.text }, ...state.images], superseded: `[state of window ${win.windowId} read; superseded by a later one]` }
        }
        case 'computer_click':
          return await this.click(args, context)
        case 'computer_type':
          return await this.type(args, context)
        case 'computer_key': {
          const win = await this.window(args)
          const keys = parseKeys(text(args, 'keys'))
          return await this.act(win, context, keys.tool, { ...keys.args, ...this.target(win, args) }, args)
        }
        case 'computer_scroll': {
          const win = await this.window(args)
          const direction = text(args, 'direction')
          return await this.act(win, context, 'scroll', { direction, amount: int(args, 'amount') ?? 3, ...this.target(win, args) }, args)
        }
        case 'computer_drag': {
          const win = await this.window(args)
          const point = { from_x: num(args, 'from_x'), from_y: num(args, 'from_y'), to_x: num(args, 'to_x'), to_y: num(args, 'to_y') }
          return await this.act(win, context, 'drag', point, args)
        }
        case 'computer_menu': {
          const win = await this.window(args)
          const path = Array.isArray(args.path) ? args.path.map(String) : []
          if (!path.length) throw new Error('"path" is required, e.g. ["File", "Save"]')
          return await this.act(win, context, 'invoke_menu', { path }, args)
        }
        case 'computer_steps':
          return await this.steps(args, context)
      }
      return result(`Unknown tool ${name}`, true)
    } catch (err) {
      return result((err as Error).message, true)
    }
  }

  // ---------------------------------------------------------------- windows

  private remember(list: unknown): WindowInfo[] {
    const raw = Array.isArray(list) ? (list as Record<string, unknown>[]) : []
    const windows = raw
      .filter((w) => Number(w.width ?? 1) > 1 && Number(w.height ?? 1) > 1)
      .sort((a, b) => Number(b.z_index ?? -1) - Number(a.z_index ?? -1))
      .map((w) => ({
        pid: Number(w.pid),
        windowId: Number(w.window_id),
        app: String(w.app_name ?? w.app ?? 'app'),
        title: String(w.title ?? '')
      }))
    for (const w of windows) this.windows.set(w.windowId, w)
    return windows
  }

  private async findWindows(filter: Record<string, unknown>): Promise<WindowInfo[]> {
    const r = await driver().call('list_windows', { on_screen_only: true, ...filter })
    if (r.isError) throw new Error(r.text || 'Could not list windows')
    return this.remember(r.structured?.windows)
  }

  private async listWindows(app?: string): Promise<McpToolResult> {
    const windows = await this.findWindows(app ? { app } : {})
    if (!windows.length) return result(app ? `No open windows for "${app}". Start it with computer_open.` : 'No open windows.')
    const lines = windows.slice(0, MAX_LIST_LINES).map((w) => `${w.windowId}: ${w.app}${w.title ? ` — "${w.title}"` : ''}`)
    return result(`Open windows (front first), as id: app — title:\n${lines.join('\n')}`)
  }

  private async listApps(find?: string): Promise<McpToolResult> {
    const r = await driver().call('list_apps', {})
    if (r.isError) return result(r.text || 'Could not list apps', true)
    const needle = find?.trim().toLowerCase()
    const apps = Array.isArray(r.structured?.apps) ? (r.structured.apps as Record<string, unknown>[]) : []
    const names = apps.length
      ? apps.map((a) => `${String(a.name ?? a.display_name ?? a.bundle_id ?? '')}${a.running ? ' (running)' : ''}`)
      : r.text.split('\n').slice(1)
    const matches = names.map((n) => n.trim()).filter((n) => n && (!needle || n.toLowerCase().includes(needle)))
    if (!matches.length) return result(needle ? `No installed app matches "${find}".` : 'No apps found.')
    const more = matches.length > MAX_LIST_LINES ? `\n…and ${matches.length - MAX_LIST_LINES} more; narrow with find.` : ''
    return result(`${matches.slice(0, MAX_LIST_LINES).join('\n')}${more}`)
  }

  /** The window `args.window` names, looking it up again if it's new since the last list. */
  private async window(args: Record<string, unknown>): Promise<WindowInfo> {
    const id = int(args, 'window')
    if (id === undefined) throw new Error('"window" is required: a window id from computer_windows')
    const known = this.windows.get(id)
    if (known) return known
    await this.findWindows({})
    const found = this.windows.get(id)
    if (!found) throw new Error(`There is no window ${id} (it may have closed). Call computer_windows for the current ones.`)
    return found
  }

  // ---------------------------------------------------------------- reading

  private async observe(
    win: WindowInfo,
    context: ComputerContext,
    options: { full?: boolean; query?: string } = {}
  ): Promise<{ text: string; images: { type: 'image'; data: string; mimeType: string }[] }> {
    const since = options.full || options.query ? undefined : this.snapshots.get(win.windowId)
    const r = await driver().call('get_window_state', {
      pid: win.pid,
      window_id: win.windowId,
      include_screenshot: Boolean(context.screenshots),
      ...(context.screenshots ? { max_image_dimension: SCREENSHOT_EDGE } : {}),
      max_elements: MAX_ELEMENTS,
      ...(since ? { since } : {}),
      ...(options.query ? { query: options.query } : {})
    })
    if (r.isError) {
      if (/not found|no such window|closed/i.test(r.text)) this.forget(win.windowId)
      return { text: `Could not read window ${win.windowId}: ${r.text}`, images: [] }
    }
    const s = r.structured ?? {}
    if (typeof s.snapshot_id === 'string') this.snapshots.set(win.windowId, s.snapshot_id)
    if (typeof s.window_title === 'string') win.title = s.window_title
    const tree = typeof s.tree_markdown === 'string' ? s.tree_markdown : ''
    if (tree && !options.query) this.rows.set(win.windowId, rowsOf(tree))

    const header = `Window ${win.windowId}: ${win.app}${win.title ? ` — "${win.title}"` : ''}`
    let body: string
    if (s.since_status === 'no_change') body = 'No visible change.'
    else if (typeof s.tree_diff === 'string' && s.tree_diff.trim()) body = `Changes:\n${cleanDiff(s.tree_diff)}`
    else body = tree.trim() || '(no elements)'
    const notes: string[] = []
    if (s.truncated) notes.push('The window has more rows than shown; use computer_look with find to search it.')
    const few = Number(s.element_count ?? 0) <= 2
    if (s.degraded && few) {
      notes.push(
        context.screenshots
          ? 'This app exposes few elements; use x,y from the screenshot.'
          : "This app exposes few elements, and you can't see screenshots. Keyboard shortcuts may still work."
      )
    }
    const images = r.images.slice(0, 1).map((i) => ({ type: 'image' as const, data: i.data, mimeType: i.mimeType }))
    return { text: [header, body, ...notes].join('\n'), images }
  }

  private forget(windowId: number): void {
    this.windows.delete(windowId)
    this.snapshots.delete(windowId)
    this.rows.delete(windowId)
  }

  /** Where in the window an action lands: an element row, a point, or (neither) the window itself. */
  private target(win: WindowInfo, args: Record<string, unknown>): Record<string, unknown> {
    const element = int(args, 'element')
    if (element !== undefined) {
      const snapshot = this.snapshots.get(win.windowId)
      if (!snapshot) throw new Error(`Read window ${win.windowId} with computer_look first, so its rows are numbered.`)
      return { element_token: `${snapshot}:${element}` }
    }
    const x = num(args, 'x')
    const y = num(args, 'y')
    if (x !== undefined && y !== undefined) return { x, y }
    return {}
  }

  // ---------------------------------------------------------------- acting

  /** Asks the user once per app per reply (or never, for apps they always allow). Blocked apps are refused. */
  private async authorize(app: string, title: string, context: ComputerContext): Promise<void> {
    const key = appKey(app)
    const blocked = (settings.get('computerBlockedApps') ?? []).map(appKey).filter(Boolean)
    if (blocked.some((b) => key.includes(b) || b.includes(key))) {
      throw new Error(`The user has blocked Llama Run from controlling ${app}. Tell them; don't try another way.`)
    }
    if ((settings.get('computerAllowedApps') ?? []).map(appKey).includes(key)) return
    const chatId = context.chatId ?? ''
    if (this.grants.get(chatId)?.has(key)) return
    const answer = await askApproval(context.chatId, {
      title: `Let Llama Run control ${app}?`,
      command: title ? `${app} — ${title}` : app,
      detail: 'It can click, type and press keys in this app until this reply finishes. Stop it any time from the card at the top of the screen or with Ctrl+Alt+Esc.',
      alwaysLabel: `Always allow ${app}`
    })
    if (answer === 'deny') throw new Error(`The user didn't allow controlling ${app}. Ask them how to continue.`)
    if (answer === 'always') settings.set({ computerAllowedApps: [...(settings.get('computerAllowedApps') ?? []), key] })
    const granted = this.grants.get(chatId) ?? new Set<string>()
    granted.add(key)
    this.grants.set(chatId, granted)
  }

  private async act(
    win: WindowInfo,
    context: ComputerContext,
    tool: string,
    toolArgs: Record<string, unknown>,
    args: Record<string, unknown>
  ): Promise<McpToolResult> {
    await this.authorize(win.app, win.title, context)
    if (context.chatId) indicator.using(context.chatId, win.app)
    const r = await driver().call(tool, {
      pid: win.pid,
      window_id: win.windowId,
      ...toolArgs,
      ...(args.foreground === true ? { delivery_mode: 'foreground' } : {})
    })
    return this.after(win, context, r)
  }

  /** An action's outcome plus what changed in the window (or the popup it opened). */
  private async after(win: WindowInfo, context: ComputerContext, r: DriverResult): Promise<McpToolResult> {
    const s = r.structured ?? {}
    const summary = (typeof s.summary === 'string' && s.summary) || r.text.split('\n')[0] || 'Done.'
    if (r.isError) {
      let message = r.text || `Failed${r.errorCode ? ` (${r.errorCode})` : ''}`
      if (/stale/i.test(`${r.errorCode} ${r.text}`)) message += '\nThe window changed: read it again with computer_look.'
      else if (/background/i.test(`${r.errorCode} ${r.text}`)) message += '\nTry again with foreground: true.'
      return result(message, true)
    }
    let target = win
    const popup = s.popup as { window_id?: unknown; pid?: unknown } | undefined
    if (popup?.window_id !== undefined) {
      target = { pid: Number(popup.pid ?? win.pid), windowId: Number(popup.window_id), app: win.app, title: 'popup menu' }
      this.windows.set(target.windowId, target)
    }
    const state = await this.observe(target, context)
    const effect = typeof s.effect === 'string' && s.effect !== 'confirmed' && s.effect !== 'unverifiable' ? ` (${s.effect})` : ''
    const line = `${summary}${effect}`
    return {
      content: [{ type: 'text', text: `${line}\n\n${state.text}` }, ...state.images],
      superseded: `${line}\n[window state superseded by a later one]`
    }
  }

  private async open(args: Record<string, unknown>, context: ComputerContext): Promise<McpToolResult> {
    const app = text(args, 'app')
    await this.authorize(app, '', context)
    if (context.chatId) indicator.using(context.chatId, app)
    const before = new Set((await this.findWindows({}).catch(() => [])).map((w) => w.windowId))
    const r = await driver().call('launch_app', {
      name: app,
      ...(Array.isArray(args.args) && args.args.length ? { additional_arguments: args.args.map(String) } : {}),
      ...(typeof args.url === 'string' && args.url ? { urls: [args.url] } : {})
    })
    if (r.isError) return result(r.text || `Could not open ${app}`, true)
    const pid = Number(r.structured?.pid) || undefined

    // Wait for its window: one of the launched process, else any new window of the app.
    const deadline = Date.now() + OPEN_WAIT_MS
    let win: WindowInfo | undefined
    while (!win && Date.now() < deadline) {
      const windows = await this.findWindows({}).catch(() => [])
      win =
        windows.find((w) => pid && w.pid === pid) ??
        windows.find((w) => !before.has(w.windowId) && (appKey(w.app).includes(appKey(app)) || appKey(app).includes(appKey(w.app)))) ??
        windows.find((w) => !before.has(w.windowId))
      if (!win) await new Promise((done) => setTimeout(done, 250))
    }
    if (!win) return result(`${r.text || `Started ${app}`}. Its window hasn't appeared yet; check computer_windows in a moment.`)
    // The user allowed this app by the name the model used; the window's own app name is the same app.
    const granted = this.grants.get(context.chatId ?? '') ?? new Set<string>()
    granted.add(appKey(win.app))
    this.grants.set(context.chatId ?? '', granted)
    const state = await this.observe(win, context, { full: true })
    return { content: [{ type: 'text', text: `Opened ${app}.\n\n${state.text}` }, ...state.images], superseded: `Opened ${app} (window ${win.windowId}).` }
  }

  private async click(args: Record<string, unknown>, context: ComputerContext): Promise<McpToolResult> {
    const win = await this.window(args)
    const clicks = int(args, 'clicks') ?? 1
    const button = typeof args.button === 'string' ? args.button : 'left'
    const where = this.target(win, args)
    if (!Object.keys(where).length) throw new Error('Give an element row, or x and y.')
    if (button === 'right') return this.act(win, context, 'right_click', where, args)
    return this.act(win, context, 'click', { ...where, button, ...(clicks > 1 ? { count: Math.min(clicks, 3) } : {}) }, args)
  }

  private async type(args: Record<string, unknown>, context: ComputerContext): Promise<McpToolResult> {
    const win = await this.window(args)
    const value = typeof args.text === 'string' ? args.text : ''
    const element = int(args, 'element')
    if (element !== undefined) await this.confirmSecret(win, element, context)
    const where = this.target(win, args)
    const replace = args.replace === true && 'element_token' in where
    const step = replace ? { tool: 'set_value', args: { ...where, value } } : { tool: 'type_text', args: { ...where, text: value } }
    if (args.submit !== true) return this.act(win, context, step.tool, step.args, args)
    // Typing then Enter as one batch: one driver call, one look afterwards.
    return this.act(win, context, 'run_steps', { steps: [step, { tool: 'press_key', args: { key: 'enter' } }] }, args)
  }

  /** Typing into a password field always asks, even in an allowed app. */
  private async confirmSecret(win: WindowInfo, element: number, context: ComputerContext): Promise<void> {
    const row = this.rows.get(win.windowId)?.get(element)
    if (!row || !/password|passcode|\bpin\b|secure/i.test(row)) return
    const answer = await askApproval(context.chatId, {
      title: `Type into a password field in ${win.app}?`,
      command: row,
      detail: 'Llama Run asks every time it types into a password field.',
      alwaysLabel: 'Allow this time'
    })
    if (answer === 'deny') throw new Error("The user didn't allow typing into the password field. Ask them to type it themselves.")
  }

  private async steps(args: Record<string, unknown>, context: ComputerContext): Promise<McpToolResult> {
    const win = await this.window(args)
    const list = Array.isArray(args.steps) ? (args.steps as Record<string, unknown>[]) : []
    if (!list.length) throw new Error('"steps" is required')
    const steps = []
    for (const step of list) {
      const element = int(step, 'element')
      if (element !== undefined && step.action === 'type') await this.confirmSecret(win, element, context)
      const where = this.target(win, step)
      switch (step.action) {
        case 'click': {
          const right = step.button === 'right'
          const clicks = int(step, 'clicks') ?? 1
          steps.push({ tool: right ? 'right_click' : 'click', args: { ...where, ...(!right && clicks > 1 ? { count: Math.min(clicks, 3) } : {}) } })
          break
        }
        case 'type': {
          const value = typeof step.text === 'string' ? step.text : ''
          steps.push(
            step.replace === true && 'element_token' in where
              ? { tool: 'set_value', args: { ...where, value } }
              : { tool: 'type_text', args: { ...where, text: value } }
          )
          break
        }
        case 'key': {
          const keys = parseKeys(typeof step.keys === 'string' ? step.keys : '')
          steps.push({ tool: keys.tool, args: { ...keys.args, ...where } })
          break
        }
        case 'scroll':
          steps.push({ tool: 'scroll', args: { direction: typeof step.direction === 'string' ? step.direction : 'down', amount: int(step, 'amount') ?? 3, ...where } })
          break
        default:
          throw new Error(`Unknown step action "${String(step.action)}": use click, type, key or scroll`)
      }
    }
    return this.act(win, context, 'run_steps', { steps }, args)
  }
}

export const computer = new Computer()

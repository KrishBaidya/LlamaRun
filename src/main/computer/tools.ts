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
 * a small set built the way the driver's own guide says to drive it:
 *
 * - Every action is one `run_steps` call with `observe`: the action and a
 *   diff of what changed in the window come back together, so the model never
 *   spends a round just looking.
 * - Windows are named by id and elements by their row number [N] in the
 *   window's latest read (or by role and name); Cua's element tokens never
 *   reach the model.
 * - Older window states are marked `superseded`, so the chat loop drops them
 *   from later requests (see llm/toolPayload.ts).
 *
 * Input goes to the target window in the background: the user's own mouse and
 * keyboard keep working. Each app needs the user's OK once per reply.
 */

const SERVER = 'Computer use'
/** Long edge of screenshots sent to vision models: enough to read UI text, small enough to stay fast. */
const SCREENSHOT_EDGE = 1280
/** Elements read per snapshot; the model can narrow with `find` to see further. */
const MAX_ELEMENTS = 400
/**
 * Time budget for reading a window's accessibility tree. The driver's default
 * (1 s on Windows) returns partial trees for Chromium and Electron windows,
 * which take 2 to 3 s.
 */
const READ_TIMEOUT_MS = 3000
/** How long computer_open waits for a window when the launch didn't report one. */
const OPEN_WAIT_MS = 5000
const MAX_LIST_LINES = 60
const WINDOWS = process.platform === 'win32'
/** Gap between typed characters on the Windows message path (driver default 30 ms: 15 s for 500 characters). */
const TYPE_DELAY_MS = 10

export interface ComputerContext {
  chatId?: string
  /** Send screenshots back (the model can see images). */
  screenshots?: boolean
}

interface WindowInfo {
  pid: number
  windowId: number
  /** The app as the user knows it: "Calculator", not "ApplicationFrameHost". */
  app: string
  title: string
  minimized?: boolean
}

/** A driver step for run_steps: `{tool, args}` with args exactly that tool's. */
interface Step {
  tool: string
  args: Record<string, unknown>
}

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): McpToolInfo => ({
  name,
  server: SERVER,
  description,
  inputSchema: { type: 'object', properties, required }
})

const WINDOW = { type: 'integer', description: 'Window id from computer_windows.' }
const ELEMENT = { type: 'integer', description: "Row number [N] from the window's latest state." }
const NAME = { type: 'string', description: 'Instead of a row: the element\'s label, e.g. "Save". Found fresh (slower than a row), so it works after the window changed.' }
const ROLE = { type: 'string', description: 'With name: button, textfield, link, checkbox, menuitem, ...' }
const X = { type: 'number', description: 'Window-local x in the screenshot, for things with no row.' }
const Y = { type: 'number', description: 'Window-local y in the screenshot.' }
const FOREGROUND = { type: 'boolean', description: 'Bring the window to the front for this action. Only after a background action was refused.' }

export const COMPUTER_TOOLS: McpToolInfo[] = [
  tool('computer_windows', 'List open windows: id, app and title (minimized ones too).', { app: { type: 'string', description: 'Only windows of this app.' } }, []),
  tool('computer_apps', 'List installed apps that computer_open can start.', { find: { type: 'string', description: 'Only apps whose name contains this.' } }, []),
  tool(
    'computer_open',
    "Start an app in the background (or reuse it if it's running) and return its window's state. To open a web page, give url; with app too, it opens in that app.",
    {
      app: { type: 'string', description: 'App name as in the Start menu, e.g. "Notepad", "Calculator", "Microsoft Edge".' },
      args: { type: 'array', items: { type: 'string' }, description: 'Command-line arguments.' },
      url: { type: 'string', description: 'A web page or file to open.' }
    },
    []
  ),
  tool(
    'computer_look',
    'Read a window: its elements as rows [N] role "name" (and a screenshot when you can see images). Use find to search a long window.',
    { window: WINDOW, find: { type: 'string', description: 'Only rows matching this text (plus their parents).' } },
    ['window']
  ),
  tool(
    'computer_click',
    'Click an element (by row, or by name) or a point. Returns what changed.',
    {
      window: WINDOW,
      element: ELEMENT,
      name: NAME,
      role: ROLE,
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
    "Put text into a field. With an element (needed for modern Windows apps) the field's whole text becomes `text`, so include anything already there you want to keep; on a drop-down it picks that option. For web pages and Electron apps, give x,y of the field. submit presses Enter after.",
    { window: WINDOW, text: { type: 'string' }, element: ELEMENT, name: NAME, role: ROLE, x: X, y: Y, submit: { type: 'boolean' }, foreground: FOREGROUND },
    ['window', 'text']
  ),
  tool(
    'computer_key',
    'Press a key or shortcut in a window, e.g. "enter", "ctrl+s", "alt+f4". With element, that element gets focus first.',
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
    'Choose an app menu item by its path, e.g. ["File", "Save As..."]. Opens the menus for you.',
    { window: WINDOW, path: { type: 'array', items: { type: 'string' } } },
    ['window', 'path']
  ),
  tool(
    'computer_steps',
    'Run several actions in one window in order, stopping at the first failure, and return what changed. The fastest way to do a known sequence (fill a form, then submit). Target later steps by name: rows can shift after a step changes the window.',
    {
      window: WINDOW,
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['click', 'type', 'key', 'scroll'] },
            element: ELEMENT,
            name: NAME,
            role: ROLE,
            x: X,
            y: Y,
            text: { type: 'string', description: 'type: the text.' },
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
    "You can operate apps on the user's PC with the computer_* tools. Work like this:",
    '1. computer_windows to find the window, or computer_open to start the app (it reuses a running one). Then computer_look to read it.',
    '2. Act on elements by their row number [N] (fastest), or by name when rows may have changed: computer_click, computer_type, computer_key. Use x,y only for things with no row.',
    '3. Every action returns what changed, so you rarely need computer_look again. Rows refer to the latest state of that window; "rows shifted" lines tell you the new numbers.',
    '4. For several known actions in one window, use computer_steps: one call instead of many.',
    'Typing: pass the field as element. On Windows that sets the whole field, so to add to existing text include it. Web pages and Electron apps: use x,y of the field instead.',
    'Input goes to the window in the background; the user can keep working. If an action is refused in the background, retry that action once with foreground: true. Never use Win-key shortcuts, Alt+Tab or Ctrl+Tab: they take over the screen. Open web pages with computer_open url, one window per page.',
    'Act without asking for each step, but stop and ask the user before anything hard to undo: sending messages or email, buying, deleting, or changing account or security settings. When a result says something may not have worked, look before trying again so nothing happens twice.'
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

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/** "notepad.exe", "Notepad" -> "notepad": how app grants and blocks are matched. */
export function appKey(app: string): string {
  return app
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '')
}

/**
 * The app name to show and match for a window. Store apps (Calculator,
 * Notepad, Settings) are hosted by ApplicationFrameHost, whose name means
 * nothing to the user; their window title names the app.
 */
export function appLabel(app: string, title: string): string {
  if (/^applicationframehost(\.exe)?$/i.test(app.trim()) && title.trim()) return title.split(/ [-–—] /).pop()!.trim()
  return app
}

const MODIFIERS = new Set(['ctrl', 'control', 'shift', 'alt', 'win', 'windows', 'super', 'meta', 'cmd'])

/** "ctrl+shift+s" -> a hotkey; "enter" -> a single key. Shortcuts that take over the screen are refused. */
export function parseKeys(keys: string): Step {
  const parts = keys
    .split('+')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .map((k) => (k === 'control' ? 'ctrl' : k === 'esc' ? 'escape' : k === 'enter' ? 'return' : k === 'del' ? 'delete' : k))
  if (!parts.length) throw new Error('"keys" is required')
  const combo = parts.join('+')
  // These go to the shell or switch tabs and windows, whatever window they're sent to.
  if (parts.some((k) => ['win', 'windows', 'super', 'meta', 'cmd'].includes(k)) || /^(alt\+(tab|escape)|ctrl\+(escape|tab|shift\+tab|\d))$/.test(combo)) {
    throw new Error(`"${keys}" would take over the user's screen, so it isn't allowed. Use computer_open, computer_windows or the app's own menus instead.`)
  }
  if (parts.length === 1 && !MODIFIERS.has(parts[0])) return { tool: 'press_key', args: { key: parts[0] } }
  return { tool: 'hotkey', args: { keys: parts } }
}

/** Cua's diff text names snapshot ids and element tokens; the model only needs rows. */
export function cleanDiff(diff: string): string {
  return diff
    .split('\n')
    .filter((line) => !/^Invalidated snapshots/i.test(line.trim()))
    .map((line) =>
      line
        .replace(/\s*Use element_tokens \S+ for [^.]*\.\s*/i, ' ')
        .replace(/;?\s*use snapshot_id \S+ in element_tokens \([^)]*\)\.?/gi, '.')
        .replace(/\s*-?\s*ids are from s[0-9a-f]{6,}\.?/gi, '')
        .replace(/\bsince s[0-9a-f]{6,}\b/gi, 'since your last look')
        .replace(/^reindexed:/i, 'rows shifted:')
        .trimEnd()
    )
    .filter((line) => line.trim())
    .join('\n')
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
  /** Window id -> snapshot id of its latest read; row numbers refer to it. */
  private snapshots = new Map<number, string>()
  /** Window id -> its rows, from the latest full read. */
  private rows = new Map<number, Map<number, string>>()
  /** Windows the driver holds a screenshot frame for, which pixel actions need. */
  private framed = new Set<number>()
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
          return await this.listWindows(str(args.app))
        case 'computer_apps':
          return await this.listApps(str(args.find))
        case 'computer_open':
          return await this.open(args, context)
        case 'computer_look': {
          const win = await this.window(args)
          const state = await this.read(win, context, { full: true, query: str(args.find) })
          return { content: [{ type: 'text', text: state.text }, ...state.images], superseded: `[state of window ${win.windowId} read; superseded by a later one]` }
        }
        case 'computer_click':
          return await this.click(args, context)
        case 'computer_type':
          return await this.type(args, context)
        case 'computer_key': {
          const win = await this.window(args)
          const keys = parseKeys(text(args, 'keys'))
          return await this.act(win, context, [{ tool: keys.tool, args: { ...keys.args, ...this.target(win, args) } }], args)
        }
        case 'computer_scroll': {
          const win = await this.window(args)
          const direction = text(args, 'direction')
          return await this.act(win, context, [{ tool: 'scroll', args: { direction, amount: int(args, 'amount') ?? 3, ...this.target(win, args) } }], args)
        }
        case 'computer_drag': {
          const win = await this.window(args)
          const points = { from_x: num(args, 'from_x'), from_y: num(args, 'from_y'), to_x: num(args, 'to_x'), to_y: num(args, 'to_y') }
          if (Object.values(points).some((v) => v === undefined)) throw new Error('from_x, from_y, to_x and to_y are required')
          return await this.act(win, context, [{ tool: 'drag', args: points }], args, true)
        }
        case 'computer_menu':
          return await this.menu(args, context)
        case 'computer_steps':
          return await this.steps(args, context)
      }
      return result(`Unknown tool ${name}`, true)
    } catch (err) {
      return result((err as Error).message, true)
    }
  }

  // ---------------------------------------------------------------- windows

  /** Keeps the windows a person would recognise: on screen or minimized, and named. */
  private remember(list: unknown): WindowInfo[] {
    const raw = Array.isArray(list) ? (list as Record<string, unknown>[]) : []
    const windows = raw
      .filter((w) => {
        const visible = w.is_on_screen !== false || w.minimized === true
        const sized = Number(w.width ?? (w.bounds as { width?: number })?.width ?? 1) > 1
        return visible && (sized || w.minimized === true) && (String(w.title ?? '').trim() || w.is_on_screen !== false)
      })
      .sort((a, b) => Number(b.z_index ?? -1) - Number(a.z_index ?? -1))
      .map((w) => {
        const title = String(w.title ?? '')
        return {
          pid: Number(w.pid),
          windowId: Number(w.window_id),
          app: appLabel(String(w.app_name ?? w.app ?? 'app'), title),
          title,
          minimized: w.minimized === true
        }
      })
    for (const w of windows) this.windows.set(w.windowId, w)
    return windows
  }

  private async findWindows(filter: Record<string, unknown>): Promise<WindowInfo[]> {
    const r = await driver().call('list_windows', filter)
    if (r.isError) throw new Error(r.text || 'Could not list windows')
    return this.remember(r.structured?.windows)
  }

  private async listWindows(app?: string): Promise<McpToolResult> {
    let windows = await this.findWindows(app ? { app } : {})
    // Store apps are listed under ApplicationFrameHost, so "Calculator" only matches their title.
    if (app && !windows.length) windows = (await this.findWindows({})).filter((w) => appKey(`${w.app} ${w.title}`).includes(appKey(app)))
    if (!windows.length) return result(app ? `No open windows for "${app}". Start it with computer_open.` : 'No open windows.')
    const lines = windows
      .slice(0, MAX_LIST_LINES)
      .map((w) => `${w.windowId}: ${w.app}${w.title && w.title !== w.app ? ` — "${w.title}"` : ''}${w.minimized ? ' (minimized)' : ''}`)
    return result(`Open windows (front first), as id: app — title:\n${lines.join('\n')}`)
  }

  private async listApps(find?: string): Promise<McpToolResult> {
    const r = await driver().call('list_apps', {})
    if (r.isError) return result(r.text || 'Could not list apps', true)
    const needle = find?.toLowerCase()
    const apps = Array.isArray(r.structured?.apps) ? (r.structured.apps as Record<string, unknown>[]) : []
    const names = apps.length ? apps.map((a) => `${String(a.name ?? a.bundle_id ?? '')}${a.running ? ' (running)' : ''}`) : r.text.split('\n').slice(1)
    const matches = [...new Set(names.map((n) => n.trim()))].filter((n) => n && (!needle || n.toLowerCase().includes(needle)))
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

  private forget(windowId: number): void {
    this.windows.delete(windowId)
    this.snapshots.delete(windowId)
    this.rows.delete(windowId)
    this.framed.delete(windowId)
  }

  // ---------------------------------------------------------------- reading

  /** get_window_state arguments shared by direct reads and run_steps' `observe`. */
  private readArgs(context: ComputerContext): Record<string, unknown> {
    return {
      include_screenshot: Boolean(context.screenshots),
      ...(context.screenshots ? { max_image_dimension: SCREENSHOT_EDGE } : {}),
      max_elements: MAX_ELEMENTS,
      timeout_ms: READ_TIMEOUT_MS
    }
  }

  private async read(
    win: WindowInfo,
    context: ComputerContext,
    options: { full?: boolean; query?: string } = {}
  ): Promise<{ text: string; images: { type: 'image'; data: string; mimeType: string }[] }> {
    const since = options.full || options.query ? undefined : this.snapshots.get(win.windowId)
    const r = await driver().call('get_window_state', {
      pid: win.pid,
      window_id: win.windowId,
      ...this.readArgs(context),
      ...(since ? { since } : {}),
      ...(options.query ? { query: options.query } : {})
    })
    if (r.isError) {
      if (/window_id_not_found|not found|invalid window handle|closed/i.test(`${r.errorCode} ${r.text}`)) this.forget(win.windowId)
      return { text: `Could not read window ${win.windowId}: ${r.text}`, images: [] }
    }
    return this.describe(win, r.structured ?? {}, r.images, context, Boolean(options.query))
  }

  /** A window state (from a read or a batch's observation) as text for the model, remembering its snapshot. */
  private describe(
    win: WindowInfo,
    s: Record<string, unknown>,
    images: DriverResult['images'],
    context: ComputerContext,
    projected = false
  ): { text: string; images: { type: 'image'; data: string; mimeType: string }[] } {
    if (typeof s.snapshot_id === 'string') this.snapshots.set(win.windowId, s.snapshot_id)
    if (typeof s.window_title === 'string' && s.window_title) win.title = s.window_title
    if (images.length) this.framed.add(win.windowId)
    const tree = typeof s.tree_markdown === 'string' ? s.tree_markdown : ''
    if (tree && !projected) this.rows.set(win.windowId, rowsOf(tree))

    const header = `Window ${win.windowId}: ${win.app}${win.title && win.title !== win.app ? ` — "${win.title}"` : ''}`
    let body: string
    if (s.since_status === 'no_change') body = 'No visible change.'
    else if (typeof s.tree_diff === 'string' && s.tree_diff.trim()) body = `Changes:\n${cleanDiff(s.tree_diff)}`
    else body = tree.trim() || '(no elements)'
    const notes: string[] = []
    if (s.truncated) {
      notes.push(
        s.truncation_reason === 'timeout' || s.elements_complete === false
          ? 'The window took too long to read in full; rows may be missing. Use computer_look with find to search it.'
          : 'The window has more rows than shown; use computer_look with find to search it.'
      )
    }
    if (s.degraded && Number(s.element_count ?? 0) <= 2) {
      notes.push(
        context.screenshots
          ? 'This app exposes few elements; use x,y from the screenshot.'
          : "This app exposes few elements, and you can't see screenshots. Keyboard shortcuts and its menus may still work."
      )
    }
    const shots = images.slice(0, 1).map((i) => ({ type: 'image' as const, data: i.data, mimeType: i.mimeType }))
    return { text: [header, body, ...notes].join('\n'), images: shots }
  }

  /** Where in the window an action lands: an element row, an element by name, a point, or the window itself. */
  private target(win: WindowInfo, args: Record<string, unknown>): Record<string, unknown> {
    const element = int(args, 'element')
    if (element !== undefined) {
      const snapshot = this.snapshots.get(win.windowId)
      if (!snapshot) throw new Error(`Read window ${win.windowId} with computer_look first so its rows are numbered, or name the element instead.`)
      return { element_token: `${snapshot}:${element}` }
    }
    const name = str(args.name)
    if (name) return { name, ...(str(args.role) ? { role: str(args.role) } : {}), ...(int(args, 'nth') !== undefined ? { nth: int(args, 'nth') } : {}) }
    const x = num(args, 'x')
    const y = num(args, 'y')
    if (x !== undefined && y !== undefined) return { x, y }
    return {}
  }

  /** Pixel actions need the driver to hold a screenshot of the window; take one if it doesn't (rows stay valid). */
  private async ensureFrame(win: WindowInfo, steps: Step[], pixelOnly = false): Promise<void> {
    if (this.framed.has(win.windowId)) return
    if (!pixelOnly && !steps.some((s) => 'x' in s.args)) return
    const r = await driver().call('get_window_state', { pid: win.pid, window_id: win.windowId, include_accessibility_tree: false, include_screenshot: true })
    if (!r.isError) this.framed.add(win.windowId)
  }

  // ---------------------------------------------------------------- acting

  /** Asks the user once per app per reply (or never, for apps they always allow). Blocked apps are refused. */
  private async authorize(app: string, title: string, context: ComputerContext): Promise<void> {
    const key = appKey(app)
    const blocked = (settings.get('computerBlockedApps') ?? []).map(appKey).filter(Boolean)
    if (blocked.some((b) => key.includes(b) || b.includes(key) || appKey(title).includes(b))) {
      throw new Error(`The user has blocked Llama Run from controlling ${app}. Tell them; don't try another way.`)
    }
    if ((settings.get('computerAllowedApps') ?? []).map(appKey).includes(key)) return
    const chatId = context.chatId ?? ''
    if (this.grants.get(chatId)?.has(key)) return
    const answer = await askApproval(context.chatId, {
      title: `Let Llama Run control ${app}?`,
      command: title && title !== app ? `${app} — ${title}` : app,
      detail: 'It can click, type and press keys in this app until this reply finishes. Stop it any time from the card at the top of the screen or with Ctrl+Alt+Esc.',
      alwaysLabel: `Always allow ${app}`
    })
    if (answer === 'deny') throw new Error(`The user didn't allow controlling ${app}. Ask them how to continue.`)
    if (answer === 'always') settings.set({ computerAllowedApps: [...(settings.get('computerAllowedApps') ?? []), key] })
    this.grant(chatId, key)
  }

  private grant(chatId: string, key: string): void {
    const granted = this.grants.get(chatId) ?? new Set<string>()
    granted.add(key)
    this.grants.set(chatId, granted)
  }

  /**
   * Runs actions in one window as a single `run_steps` call with `observe`:
   * the driver acts, then reads what changed, in one round trip. A step whose
   * row went stale is retried by the driver on the element with the same role
   * and label.
   */
  private async act(win: WindowInfo, context: ComputerContext, steps: Step[], args: Record<string, unknown>, pixelOnly = false): Promise<McpToolResult> {
    await this.authorize(win.app, win.title, context)
    if (context.chatId) indicator.using(context.chatId, win.app)
    await this.ensureFrame(win, steps, pixelOnly)
    const run = (): Promise<DriverResult> =>
      driver().call('run_steps', {
        pid: win.pid,
        window_id: win.windowId,
        steps,
        ...(args.foreground === true ? { delivery_mode: 'foreground' } : {}),
        observe: this.readArgs(context)
      })
    let r = await run()
    // The window changed size since its screenshot, so pixel steps were refused before anything ran: capture again, once.
    const first = (r.structured?.steps as { code?: string }[] | undefined)?.[0]
    if (first?.code === 'screenshot_context_missing' || r.errorCode === 'screenshot_context_missing') {
      this.framed.delete(win.windowId)
      await this.ensureFrame(win, steps, true)
      r = await run()
    }
    return this.outcome(win, context, r)
  }

  /** A batch's result for the model: each step's outcome (with the driver's hint when one failed), then what changed. */
  private outcome(win: WindowInfo, context: ComputerContext, r: DriverResult): McpToolResult {
    const s = r.structured ?? {}
    const steps = Array.isArray(s.steps) ? (s.steps as Record<string, unknown>[]) : []
    if (!steps.length) {
      // Not a batch result: the driver refused the call itself (bad arguments, say).
      return result(r.text || `Failed${r.errorCode ? ` (${r.errorCode})` : ''}`, true)
    }
    const lines = steps.map((step, i) => {
      const n = steps.length > 1 ? `${i + 1}. ` : ''
      const message = String(step.message ?? (step.ok ? 'done' : 'failed'))
      if (step.ok) {
        const effect = typeof step.effect === 'string' && !['confirmed', 'unverifiable'].includes(step.effect) ? ` (${step.effect})` : ''
        return `${n}${message}${effect}`
      }
      const code = String(step.code ?? '')
      const phase = step.phase && step.phase !== 'action' ? ` (${String(step.phase)})` : ''
      let advice = ''
      if (/stale/i.test(code + message)) advice = ' The window changed: read it again with computer_look, or name the element.'
      else if (/background_unavailable|background/i.test(code)) advice = ' Retry this action with foreground: true.'
      else if (typeof step.hint === 'string') advice = ` ${step.hint}`
      return `${n}Failed${phase}: ${message}${advice}`
    })
    const total = Number(s.total ?? steps.length)
    if (s.failed_step !== null && s.failed_step !== undefined && steps.length < total) {
      lines.push(`${total - steps.length} later step(s) did not run.`)
    }
    const observation = (s.observation as { state?: Record<string, unknown> } | undefined)?.state
    let state = { text: '', images: [] as { type: 'image'; data: string; mimeType: string }[] }
    if (observation) {
      // A dialog that took focus mid-batch is read instead of the window; name it so the model can act in it.
      let target = win
      const id = Number(observation.window_id)
      if (id && id !== win.windowId) {
        target = this.windows.get(id) ?? { pid: Number(observation.pid ?? win.pid), windowId: id, app: win.app, title: String(observation.window_title ?? '') }
        this.windows.set(id, target)
      }
      state = this.describe(target, observation, r.images, context)
    }
    const summary = lines.join('\n')
    const failed = steps.some((step) => !step.ok)
    return {
      content: [{ type: 'text', text: state.text ? `${summary}\n\n${state.text}` : summary }, ...state.images],
      isError: failed && steps.every((step) => !step.ok),
      superseded: `${summary}\n[window state superseded by a later one]`
    }
  }

  private async open(args: Record<string, unknown>, context: ComputerContext): Promise<McpToolResult> {
    const app = str(args.app)
    const url = str(args.url)
    if (!app && !url) throw new Error('Give app, url, or both.')
    const label = app ?? 'the browser'
    await this.authorize(label, '', context)
    if (context.chatId) indicator.using(context.chatId, label)
    const extra = Array.isArray(args.args) ? args.args.map(String) : []
    const before = new Set((await this.findWindows({}).catch(() => [])).map((w) => w.windowId))
    // A URL for a named app goes in as its argument: `urls` would open it in the default browser instead.
    const r = await driver().call('launch_app', {
      ...(app ? { name: app } : {}),
      ...(app && url ? { additional_arguments: [...extra, url] } : extra.length ? { additional_arguments: extra } : {}),
      ...(!app && url ? { urls: [url] } : {})
    })
    if (r.isError) return result(r.text || `Could not open ${label}`, true)
    const pid = Number(r.structured?.pid) || undefined

    // launch_app reports the window it waited for; a cold Store app can still be late, so look for it.
    let win: WindowInfo | undefined = this.remember(r.structured?.windows)[0]
    const deadline = Date.now() + OPEN_WAIT_MS
    while (!win && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 250))
      const windows = await this.findWindows({}).catch(() => [])
      const wanted = app ? appKey(app) : ''
      win =
        windows.find((w) => pid && w.pid === pid) ??
        windows.find((w) => !before.has(w.windowId) && (!wanted || appKey(`${w.app} ${w.title}`).includes(wanted))) ??
        windows.find((w) => !before.has(w.windowId))
    }
    if (!win) return result(`${r.text || `Started ${label}`}. Its window hasn't appeared yet; check computer_windows in a moment.`)
    // The user allowed this app by the name the model used; its window's own name is the same app.
    this.grant(context.chatId ?? '', appKey(win.app))
    const state = await this.read(win, context, { full: true })
    return { content: [{ type: 'text', text: `Opened ${label}.\n\n${state.text}` }, ...state.images], superseded: `Opened ${label} (window ${win.windowId}).` }
  }

  private async click(args: Record<string, unknown>, context: ComputerContext): Promise<McpToolResult> {
    const win = await this.window(args)
    const where = this.target(win, args)
    if (!Object.keys(where).length) throw new Error('Give an element row, a name, or x and y.')
    return this.act(win, context, [this.clickStep(args, where)], args)
  }

  private clickStep(args: Record<string, unknown>, where: Record<string, unknown>): Step {
    const clicks = Math.min(int(args, 'clicks') ?? 1, 3)
    if (args.button === 'right') return { tool: 'right_click', args: where }
    return { tool: 'click', args: { ...where, ...(args.button === 'middle' ? { button: 'middle' } : {}), ...(clicks > 1 ? { count: clicks } : {}) } }
  }

  /** Typing: a drop-down gets its option picked (set_value); anything else gets type_text. */
  private typeStep(win: WindowInfo, value: string, where: Record<string, unknown>, element?: number): Step {
    const row = element !== undefined ? this.rows.get(win.windowId)?.get(element) : undefined
    if (row && /combo ?box/i.test(row)) return { tool: 'set_value', args: { ...where, value } }
    // Windows paces typed characters 30 ms apart by default; the UI Automation path (with an element) ignores this.
    const pacing = WINDOWS && !('element_token' in where) ? { delay_ms: TYPE_DELAY_MS } : {}
    return { tool: 'type_text', args: { ...where, text: value, ...pacing } }
  }

  private async type(args: Record<string, unknown>, context: ComputerContext): Promise<McpToolResult> {
    const win = await this.window(args)
    const value = typeof args.text === 'string' ? args.text : ''
    const element = int(args, 'element')
    if (element !== undefined) await this.confirmSecret(win, element, context)
    const where = this.target(win, args)
    const steps = [this.typeStep(win, value, where, element)]
    if (args.submit === true) steps.push({ tool: 'press_key', args: { key: 'return' } })
    return this.act(win, context, steps, args)
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

  private async menu(args: Record<string, unknown>, context: ComputerContext): Promise<McpToolResult> {
    const win = await this.window(args)
    const path = Array.isArray(args.path) ? args.path.map(String) : []
    if (!path.length) throw new Error('"path" is required, e.g. ["File", "Save"]')
    await this.authorize(win.app, win.title, context)
    if (context.chatId) indicator.using(context.chatId, win.app)
    // invoke_menu can't run inside run_steps, so the look afterwards is its own read.
    const r = await driver().call('invoke_menu', { pid: win.pid, window_id: win.windowId, path })
    if (r.isError) return result(r.text || `Could not choose ${path.join(' > ')}`, true)
    const summary = (typeof r.structured?.summary === 'string' && r.structured.summary) || `Chose ${path.join(' > ')}.`
    const state = await this.read(win, context)
    return { content: [{ type: 'text', text: `${summary}\n\n${state.text}` }, ...state.images], superseded: `${summary}\n[window state superseded by a later one]` }
  }

  private async steps(args: Record<string, unknown>, context: ComputerContext): Promise<McpToolResult> {
    const win = await this.window(args)
    const list = Array.isArray(args.steps) ? (args.steps as Record<string, unknown>[]) : []
    if (!list.length) throw new Error('"steps" is required')
    if (list.length > 64) throw new Error('At most 64 steps at a time')
    const steps: Step[] = []
    for (const step of list) {
      const element = int(step, 'element')
      if (element !== undefined && step.action === 'type') await this.confirmSecret(win, element, context)
      const where = this.target(win, step)
      switch (step.action) {
        case 'click':
          steps.push(this.clickStep(step, where))
          break
        case 'type':
          steps.push(this.typeStep(win, typeof step.text === 'string' ? step.text : '', where, element))
          break
        case 'key': {
          const keys = parseKeys(typeof step.keys === 'string' ? step.keys : '')
          steps.push({ tool: keys.tool, args: { ...keys.args, ...where } })
          break
        }
        case 'scroll':
          steps.push({ tool: 'scroll', args: { direction: str(step.direction) ?? 'down', amount: int(step, 'amount') ?? 3, ...where } })
          break
        default:
          throw new Error(`Unknown step action "${String(step.action)}": use click, type, key or scroll`)
      }
    }
    return this.act(win, context, steps, args)
  }
}

export const computer = new Computer()

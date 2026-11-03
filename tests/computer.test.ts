import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  globalShortcut: { register: () => true, unregister: () => {} },
  BrowserWindow: class {},
  dialog: {},
  Notification: class {},
  safeStorage: {},
  shell: {},
  screen: {},
  utilityProcess: {}
}))

const ui = vi.hoisted(() => ({
  answer: 'once' as 'once' | 'always' | 'deny',
  asked: [] as { title: string; command: string }[],
  using: [] as [string, string][],
  done: [] as string[]
}))

vi.mock('../src/main/assistant/approval', () => ({
  askApproval: async (_chatId: string | undefined, request: { title: string; command: string }) => {
    ui.asked.push(request)
    return ui.answer
  }
}))

vi.mock('../src/main/computer/indicator', () => ({
  indicator: {
    using: (chatId: string, app: string) => ui.using.push([chatId, app]),
    done: (chatId: string) => ui.done.push(chatId),
    on: () => {}
  }
}))

const { computer, parseKeys, parseKeySequence, rowsOf, findRows, cleanDiff, cleanMessage, appLabel, escalation, COMPUTER_TOOLS } = await import('../src/main/computer/tools')
const { errorText } = await import('../src/main/computer/protocol')
const { setDriverTransport } = await import('../src/main/computer/driver')
const { settings } = await import('../src/main/settings')
const { SupersededResults, toolResultImages, toolResultToText } = await import('../src/main/llm/toolPayload')
import type { DriverResult } from '../src/main/computer/protocol'

const TREE = [
  '- [0] window "Untitled - Notepad"',
  '  - [1] menu item "File"',
  '  - [2] document "Text editor"',
  '  - [3] button "Save"',
  '  - [4] edit "Password"',
  '  - [5] combo box "Font"'
].join('\n')

/**
 * A pretend Cua Driver shaped like the real one (see the probe responses in
 * the docs): one Notepad window, a numbered tree, and run_steps that runs
 * every step and returns a `since` diff as its observation.
 */
class FakeDriver {
  calls: { tool: string; args: Record<string, unknown> }[] = []
  private snapshot = 0
  /** Step codes to fail with, by step index, for the next run_steps. */
  failNext: Record<number, string> = {}
  /** The driver's recommended next rung, on the next failing step. */
  escalateNext: Record<string, unknown> | null = null
  /** The next run_steps observation reports no change, and its steps are unconfirmed (with this hint). */
  unchangedNext: string | null = null
  /** Windows list_windows adds after the next run_steps (a dialog an action opened). */
  opensNext: Record<string, unknown>[] = []
  private extra: Record<string, unknown>[] = []
  clipboard = 'user copied this'

  private nextId(): string {
    return `s${String(++this.snapshot).padStart(8, '0')}`
  }

  private state(args: Record<string, unknown>): { structured: Record<string, unknown>; images: DriverResult['images'] } {
    const id = this.nextId()
    const images = args.include_screenshot ? [{ mimeType: 'image/png', data: 'iVBOR' }] : []
    if (args.since) {
      return {
        images,
        structured: {
          snapshot_id: id,
          window_id: 77,
          pid: 42,
          since: args.since,
          since_status: 'diff',
          tree_diff: `since ${String(args.since)}: 1 added. Use element_tokens ${id}:N for + and ~ rows and unchanged rows; - ids are from ${String(args.since)}.\n+ [6] dialog "Save as"\nreindexed: [4-5] -> [5-6]`
        }
      }
    }
    // Elements with their place in the screenshot, as tree_format "both" returns them: row N sits at y = 100 + 20N.
    const elements = rowsOf(TREE).size
      ? [...rowsOf(TREE).entries()].map(([n, line]) => ({
          element_index: n,
          role: line.split(' ')[2],
          label: /"([^"]*)"/.exec(line)?.[1] ?? '',
          screenshot_frame: { x: 10, y: 100 + 20 * n, w: 40, h: 10 }
        }))
      : []
    return {
      images,
      structured: {
        snapshot_id: id,
        window_id: 77,
        pid: 42,
        window_title: 'Untitled - Notepad',
        tree_markdown: TREE,
        element_count: 6,
        ...(args.tree_format === 'both' ? { elements } : {})
      }
    }
  }

  async call(tool: string, args: Record<string, unknown>): Promise<DriverResult> {
    this.calls.push({ tool, args })
    const ok = (text: string, structured: Record<string, unknown> = {}, images: DriverResult['images'] = []): DriverResult => ({ text, images, structured, isError: false })
    switch (tool) {
      case 'list_windows':
        return ok('3 windows', {
          windows: [
            { app_name: 'Explorer', pid: 1, window_id: 10, title: 'Downloads', width: 800, height: 600, z_index: 1, is_on_screen: true },
            { app_name: 'Notepad', pid: 42, window_id: 77, title: 'Untitled - Notepad', width: 800, height: 600, z_index: 5, is_on_screen: true },
            { app_name: 'ApplicationFrameHost', pid: 7, window_id: 12, title: 'Calculator', width: 320, height: 500, z_index: 0, is_on_screen: false, minimized: true },
            { app_name: 'Tray', pid: 2, window_id: 11, title: '', width: 1, height: 1, z_index: 9, is_on_screen: true },
            { app_name: 'Helper', pid: 3, window_id: 13, title: 'hidden', width: 100, height: 100, z_index: 2, is_on_screen: false },
            // Llama Run's own window (its approval cards): never listed, never a target.
            { app_name: 'Llama Run', pid: process.pid, window_id: 99, title: 'Llama Run', width: 800, height: 600, z_index: 8, is_on_screen: true },
            ...this.extra
          ]
        })
      case 'get_window_state': {
        if (args.include_accessibility_tree === false) return ok('frame', { window_id: 77 }, [{ mimeType: 'image/png', data: 'frame' }])
        const s = this.state(args)
        return ok('tree', s.structured, s.images)
      }
      case 'run_steps': {
        const steps = args.steps as { tool: string }[]
        const results: Record<string, unknown>[] = []
        const hint = this.unchangedNext
        for (const [i, step] of steps.entries()) {
          const code = this.failNext[i]
          if (code) {
            results.push({ index: i, ok: false, code, phase: 'action', message: `${step.tool} refused`, tool: step.tool, ...(this.escalateNext ? { escalation: this.escalateNext } : {}) })
            break
          }
          results.push(
            hint !== null
              ? { index: i, ok: true, message: `${step.tool} sent; not verified — confirm with a screenshot. [window_point=(1, 2) screen_point=(3, 4)]`, tool: step.tool, effect: 'unverifiable', hint }
              : { index: i, ok: true, message: `${step.tool} done`, tool: step.tool }
          )
        }
        this.failNext = {}
        this.escalateNext = null
        this.unchangedNext = null
        this.extra.push(...this.opensNext)
        this.opensNext = []
        const observe = args.observe as Record<string, unknown>
        const s = this.state({ ...observe, since: 'latest' })
        if (hint !== null) s.structured = { snapshot_id: s.structured.snapshot_id, window_id: 77, pid: 42, since_status: 'no_change' }
        const failed = results.findIndex((r) => !r.ok)
        return {
          text: 'run_steps',
          images: s.images,
          structured: { executed: results.length, total: steps.length, failed_step: failed < 0 ? null : failed, ok: failed < 0, steps: results, observation: { ok: true, state: s.structured } },
          isError: failed >= 0
        }
      }
      case 'launch_app':
        return ok('Launched', { pid: 42, windows: [{ app_name: 'Notepad', pid: 42, window_id: 77, title: 'Untitled - Notepad', width: 800, height: 600, is_on_screen: true }] })
      case 'invoke_menu':
        return ok('Invoked', { summary: 'Invoked File > Save' })
      case 'clipboard_read':
        return ok('clipboard', { text: this.clipboard })
      case 'clipboard_write':
        this.clipboard = String(args.text)
        return ok('written')
      default:
        return ok(`${tool} done`)
    }
  }

  async close(): Promise<void> {}

  restarts = 0
  async restart(): Promise<void> {
    this.restarts++
  }

  /** The batches sent, as their step tools. */
  batches(): string[][] {
    return this.calls.filter((c) => c.tool === 'run_steps').map((c) => (c.args.steps as { tool: string }[]).map((s) => s.tool))
  }

  lastBatch(): { tool: string; args: Record<string, unknown> }[] {
    return this.calls.filter((c) => c.tool === 'run_steps').at(-1)!.args.steps as { tool: string; args: Record<string, unknown> }[]
  }
}

const textOf = (r: { content: unknown[] }): string => toolResultToText({ content: r.content })

let fake: FakeDriver
let chat = 0
const ctx = (): { chatId: string } => ({ chatId: `chat-${chat}` })
const saved: Record<string, unknown> = {}

beforeEach(() => {
  fake = new FakeDriver()
  setDriverTransport(fake)
  chat++
  ui.answer = 'once'
  ui.asked = []
  ui.using = []
  for (const key of Object.keys(saved)) delete saved[key]
  vi.spyOn(settings, 'get').mockImplementation(((key: string) => (key in saved ? saved[key] : [])) as typeof settings.get)
  vi.spyOn(settings, 'set').mockImplementation(((patch: Record<string, unknown>) => Object.assign(saved, patch)) as unknown as typeof settings.set)
})

afterEach(() => {
  // Each test is its own reply: its session and its hold on the computer end with it.
  computer.endTurn(ctx().chatId)
  computer.endTurn('')
  vi.restoreAllMocks()
  setDriverTransport(null)
})

describe('computer use helpers', () => {
  it('parses keys and shortcuts', () => {
    expect(parseKeys('Enter')).toEqual({ tool: 'press_key', args: { key: 'return' } })
    expect(parseKeys('esc')).toEqual({ tool: 'press_key', args: { key: 'escape' } })
    expect(parseKeys('Control+Shift+S')).toEqual({ tool: 'hotkey', args: { keys: ['ctrl', 'shift', 's'] } })
    expect(() => parseKeys(' + ')).toThrow()
  })

  it('refuses shortcuts that take over the screen', () => {
    for (const keys of ['win+r', 'Win+E', 'alt+tab', 'ctrl+tab', 'ctrl+1', 'ctrl+esc']) expect(() => parseKeys(keys)).toThrow(/take over/)
    expect(parseKeys('alt+f4').tool).toBe('hotkey')
  })

  it('reads a sequence of keys, as a model wrote it in the KiCad run ("down down … enter")', () => {
    expect(parseKeySequence('down down enter')).toEqual([
      { tool: 'press_key', args: { key: 'down' } },
      { tool: 'press_key', args: { key: 'down' } },
      { tool: 'press_key', args: { key: 'return' } }
    ])
    expect(parseKeySequence('ctrl + a, delete')).toEqual([
      { tool: 'hotkey', args: { keys: ['ctrl', 'a'] } },
      { tool: 'press_key', args: { key: 'delete' } }
    ])
    expect(parseKeySequence('ctrl+s')).toEqual([{ tool: 'hotkey', args: { keys: ['ctrl', 's'] } }])
    expect(() => parseKeySequence('down alt+tab')).toThrow(/take over/)
    expect(() => parseKeySequence(Array(51).fill('down').join(' '))).toThrow(/At most 50/)
  })

  it('reads row numbers from a tree', () => {
    expect(rowsOf(TREE).get(3)).toBe('- [3] button "Save"')
  })

  it("strips the driver's token bookkeeping from diffs but keeps shifted rows", () => {
    const diff =
      'since s00000002: 5 added, 2 changed, 1 removed. Use element_tokens s00000007:N for + and ~ rows and unchanged rows; - ids are from s00000002.\n+ [1] list item ""\n~ [2] text box "42" value="42"\nreindexed: [2-27] -> [3-28]\nInvalidated snapshots s00000006: their element_tokens are stale.'
    const clean = cleanDiff(diff)
    expect(clean).not.toMatch(/element_token|s0000000|Invalidated/)
    expect(clean).toContain('since your last look: 5 added, 2 changed, 1 removed.')
    expect(clean).toContain('~ [2] text box "42" value="42"')
    expect(clean).toContain('rows shifted: [2-27] -> [3-28]')
  })

  it('names Store apps by their title, not their host process', () => {
    expect(appLabel('ApplicationFrameHost', 'Calculator')).toBe('Calculator')
    expect(appLabel('ApplicationFrameHost', 'Settings - Display')).toBe('Display')
    expect(appLabel('Notepad', 'notes.txt - Notepad')).toBe('Notepad')
  })

  it('keeps the tool list small', () => {
    expect(COMPUTER_TOOLS.length).toBeLessThanOrEqual(12)
    expect(COMPUTER_TOOLS.every((t) => t.name.startsWith('computer_'))).toBe(true)
  })
})

describe('computer use tools', () => {
  it('lists real windows front first, minimized ones too, without hidden or zero-size ones', async () => {
    const r = await computer.call('computer_windows', {}, ctx())
    const text = textOf(r)
    expect(text.indexOf('77: Notepad')).toBeLessThan(text.indexOf('10: Explorer'))
    expect(text).toContain('12: Calculator (minimized)')
    expect(text).not.toContain('Tray')
    expect(text).not.toContain('hidden')
    // All windows, not just on-screen ones: the driver can act on minimized windows.
    expect(fake.calls[0].args).toEqual({})
  })

  it('finds Store apps by name even though they are listed under their host', async () => {
    const r = await computer.call('computer_windows', { app: 'calculator' }, ctx())
    expect(textOf(r)).toContain('12: Calculator')
  })

  it('needs a look (or a name) before acting on a row', async () => {
    await computer.call('computer_windows', {}, ctx())
    const r = await computer.call('computer_click', { window: 10, element: 3 }, ctx())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('computer_look')
    expect(fake.batches()).toEqual([])
  })

  it('acts and observes in one run_steps call, asking once per app per reply', async () => {
    const look = await computer.call('computer_look', { window: 77 }, ctx())
    expect(textOf(look)).toContain('[3] button "Save"')
    expect(fake.calls.at(-1)!.args).toMatchObject({ max_elements: 250, timeout_ms: 1000, session: `llamarun-chat${chat}` })

    const r = await computer.call('computer_click', { window: 77, element: 3 }, ctx())
    expect(r.isError).toBeFalsy()
    const batch = fake.calls.find((c) => c.tool === 'run_steps')!
    expect(batch.args).toMatchObject({
      session: `llamarun-chat${chat}`,
      pid: 42,
      window_id: 77,
      observe: { include_screenshot: false, max_elements: 250, timeout_ms: 1000 }
    })
    expect(fake.lastBatch()).toEqual([{ tool: 'click', args: { element_token: 's00000001:3' } }])
    // One driver call for the action and the look afterwards.
    expect(fake.calls.filter((c) => c.tool === 'get_window_state')).toHaveLength(1)
    const text = textOf(r)
    expect(text).toContain('click done')
    expect(text).toContain('[6] dialog "Save as"')
    expect(text).toContain('rows shifted')
    expect(text).not.toMatch(/element_token|snapshot_id|s0000000/)
    expect(r.superseded).toContain('click done')
    expect(ui.asked).toHaveLength(1)
    expect(ui.asked[0].title).toContain('Notepad')
    expect(ui.using).toEqual([[`chat-${chat}`, 'Notepad']])

    // Same reply, same app: no second question. Rows now refer to the observation's snapshot.
    await computer.call('computer_key', { window: 77, keys: 'ctrl+s', element: 2 }, ctx())
    expect(ui.asked).toHaveLength(1)
    expect(fake.lastBatch()).toEqual([{ tool: 'hotkey', args: { keys: ['ctrl', 's'], element_token: 's00000002:2' } }])

    // Next reply asks again.
    computer.endTurn(`chat-${chat}`)
    expect(ui.done).toContain(`chat-${chat}`)
    await computer.call('computer_key', { window: 77, keys: 'enter' }, ctx())
    expect(ui.asked).toHaveLength(2)
  })

  it('clicks by name without reading the window first', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_windows', {}, ctx())
    await computer.call('computer_click', { window: 77, name: 'Save', role: 'button' }, ctx())
    expect(fake.lastBatch()).toEqual([{ tool: 'click', args: { name: 'Save', role: 'button' } }])
  })

  it('remembers "always allow" and never asks for that app again', async () => {
    ui.answer = 'always'
    await computer.call('computer_look', { window: 77 }, ctx())
    await computer.call('computer_click', { window: 77, element: 1 }, ctx())
    expect(saved.computerAllowedApps).toEqual(['notepad'])
    computer.endTurn(`chat-${chat}`)
    await computer.call('computer_click', { window: 77, element: 1 }, ctx())
    expect(ui.asked).toHaveLength(1)
  })

  it('stops when the user denies, before anything is sent', async () => {
    ui.answer = 'deny'
    await computer.call('computer_look', { window: 77 }, ctx())
    const r = await computer.call('computer_type', { window: 77, element: 2, text: 'hi' }, ctx())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain("didn't allow")
    expect(fake.batches()).toEqual([])
  })

  it('refuses blocked apps without asking, matching Store apps by title', async () => {
    saved.computerBlockedApps = ['calculator.exe']
    await computer.call('computer_windows', {}, ctx())
    const r = await computer.call('computer_click', { window: 12, name: '7' }, ctx())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('blocked')
    expect(ui.asked).toHaveLength(0)
    expect(fake.batches()).toEqual([])
  })

  it('asks every time before typing into a password field', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    await computer.call('computer_type', { window: 77, element: 2, text: 'notes' }, ctx())
    expect(ui.asked).toHaveLength(0)
    await computer.call('computer_look', { window: 77 }, ctx())
    await computer.call('computer_type', { window: 77, element: 4, text: 'hunter2' }, ctx())
    expect(ui.asked).toHaveLength(1)
    expect(ui.asked[0].title).toContain('password')
  })

  it('types into an element, picks drop-down options with set_value, and submits in the same batch', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    await computer.call('computer_type', { window: 77, element: 2, text: 'hello', submit: true }, ctx())
    expect(fake.lastBatch()).toEqual([
      { tool: 'type_text', args: { element_token: 's00000001:2', text: 'hello' } },
      { tool: 'press_key', args: { key: 'return' } }
    ])
    await computer.call('computer_look', { window: 77 }, ctx())
    await computer.call('computer_type', { window: 77, element: 5, text: 'Consolas' }, ctx())
    expect(fake.lastBatch()).toEqual([{ tool: 'set_value', args: { element_token: 's00000003:5', value: 'Consolas' } }])
  })

  it('aims pixels only from a screenshot the model saw, and refuses them when it sees none', async () => {
    saved.computerAllowedApps = ['notepad']
    const seeing = { ...ctx(), screenshots: true }
    // Never shown this window: nothing is sent, the screenshot comes back to aim from.
    const unseen = await computer.call('computer_click', { window: 77, x: 10, y: 20 }, seeing)
    expect(unseen.isError).toBe(true)
    expect(textOf(unseen)).toContain("haven't seen")
    expect(toolResultImages(unseen)).toEqual(['iVBOR'])
    expect(fake.batches()).toEqual([])
    // Now it has: the click goes, and its observation carries a screenshot.
    await computer.call('computer_click', { window: 77, x: 10, y: 20 }, seeing)
    expect(fake.lastBatch()).toEqual([{ tool: 'click', args: { x: 10, y: 20 } }])
    expect(fake.calls.filter((c) => c.tool === 'run_steps').at(-1)!.args).toMatchObject({ observe: { include_screenshot: true } })

    const blind = await computer.call('computer_click', { window: 77, x: 10, y: 20 }, ctx())
    expect(blind.isError).toBe(true)
    expect(textOf(blind)).toContain('would be a guess')
  })

  it('leaves screenshots out of observations after element actions', async () => {
    saved.computerAllowedApps = ['notepad']
    const seeing = { ...ctx(), screenshots: true }
    await computer.call('computer_look', { window: 77 }, seeing)
    const r = await computer.call('computer_click', { window: 77, element: 3 }, seeing)
    expect(fake.calls.find((c) => c.tool === 'run_steps')!.args).toMatchObject({ observe: { include_screenshot: false } })
    expect(toolResultImages(r)).toEqual([])
  })

  it('never moves to the foreground on its own: a refusal says how, and the model asks for it (Cua SDK rule)', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    fake.failNext = { 0: 'background_unavailable' }
    const refused = await computer.call('computer_scroll', { window: 77, direction: 'down', element: 3 }, ctx())
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('foreground: true')
    const runs = (): Record<string, unknown>[] => fake.calls.filter((c) => c.tool === 'run_steps').map((c) => c.args)
    expect(runs()).toHaveLength(1)
    // Later actions in that window stay in the background too.
    await computer.call('computer_key', { window: 77, keys: 'enter' }, ctx())
    expect(runs().at(-1)).not.toHaveProperty('foreground_fallback')
    expect(runs().at(-1)).not.toHaveProperty('delivery_mode')
    await computer.call('computer_click', { window: 77, element: 3, foreground: true }, ctx())
    expect(runs().at(-1)).toMatchObject({ delivery_mode: 'foreground' })
  })

  it("passes on the driver's recommended next step for an action that didn't land", async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    fake.failNext = { 0: 'element_not_actionable' }
    fake.escalateNext = { recommended: 'px', reason: 'The element exposes no click action' }
    const r = await computer.call('computer_click', { window: 77, element: 3 }, ctx())
    expect(textOf(r)).toContain('The driver suggests: aim by x,y on the screenshot (The element exposes no click action).')
    expect(escalation({ escalation: { recommended: 'page', reason: 'Use the page tools' } })).toBe(' Use the page tools')
    expect(escalation({})).toBe('')
  })

  it('labels every action with the chat session, so ending the reply cleans all of it up', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_menu', { window: 77, path: ['File', 'Save'] }, ctx())
    await computer.call('computer_move_window', { window: 77, x: 0, y: 0, width: 800 }, ctx())
    for (const tool of ['invoke_menu', 'set_window_frame']) expect(fake.calls.find((c) => c.tool === tool)!.args.session).toMatch(/\S/)
  })

  it('says whether an interrupted action reached the app', () => {
    expect(errorText({ tag: 'ActionInterrupted', inner: { completion: 0, reason: 'shutdown' } })).toBe('The action was interrupted and did not start (shutdown). Check the window before trying it again.')
    expect(errorText({ tag: 'ActionInterrupted', inner: { completion: 2, reason: '' } })).toContain('may or may not have happened')
    expect(errorText(new Error('boom'))).toBe('boom')
  })

  it("doesn't send delay_ms where the driver refuses it (only Windows takes it)", async () => {
    saved.computerAllowedApps = ['notepad']
    const seeing = { ...ctx(), screenshots: true }
    await computer.call('computer_look', { window: 77 }, seeing)
    await computer.call('computer_type', { window: 77, x: 1, y: 2, text: 'hi' }, seeing)
    expect(fake.lastBatch()[0]).toEqual({ tool: 'type_text', args: { x: 1, y: 2, text: 'hi', ...(process.platform === 'win32' ? { delay_ms: 8 } : {}) } })
  })

  it('reports which step failed in a batch and that later ones did not run', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    fake.failNext = { 1: 'stale_element_token' }
    const r = await computer.call(
      'computer_steps',
      { window: 77, steps: [{ action: 'click', element: 2 }, { action: 'click', element: 3 }, { action: 'key', keys: 'enter' }] },
      ctx()
    )
    const text = textOf(r)
    expect(text).toContain('1. click done')
    expect(text).toContain('2. Failed: click refused The window changed')
    expect(text).toContain('1 later step(s) did not run')
  })

  it('runs a batch of steps as one run_steps call', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    const r = await computer.call(
      'computer_steps',
      {
        window: 77,
        steps: [
          { action: 'click', element: 2 },
          { action: 'type', text: 'hello' },
          { action: 'key', keys: 'ctrl+s' },
          { action: 'click', name: 'Save', role: 'button', clicks: 2 },
          { action: 'click', element: 3, button: 'right' }
        ]
      },
      ctx()
    )
    expect(r.isError).toBeFalsy()
    expect(fake.batches()).toHaveLength(1)
    const typing = process.platform === 'win32' ? { text: 'hello', delay_ms: 8 } : { text: 'hello' }
    expect(fake.lastBatch()).toEqual([
      { tool: 'click', args: { element_token: 's00000001:2' } },
      { tool: 'type_text', args: typing },
      { tool: 'hotkey', args: { keys: ['ctrl', 's'] } },
      { tool: 'click', args: { name: 'Save', role: 'button', count: 2 } },
      { tool: 'right_click', args: { element_token: 's00000001:3' } }
    ])
  })

  it('chooses menu items, then reads what changed', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    const r = await computer.call('computer_menu', { window: 77, path: ['File', 'Save'] }, ctx())
    expect(fake.calls.find((c) => c.tool === 'invoke_menu')!.args).toEqual({ session: expect.any(String), pid: 42, window_id: 77, path: ['File', 'Save'] })
    expect(textOf(r)).toContain('Invoked File > Save')
    expect(fake.calls.filter((c) => c.tool === 'get_window_state').at(-1)).toMatchObject({ args: { since: 's00000001' } })
  })

  it('opens an app using the window launch_app reports, and reads it', async () => {
    const r = await computer.call('computer_open', { app: 'Notepad' }, ctx())
    expect(fake.calls.find((c) => c.tool === 'launch_app')!.args).toEqual({ session: expect.any(String), name: 'Notepad' })
    expect(textOf(r)).toContain('[3] button "Save"')
    // Allowed by name when opening; acting in its window doesn't ask again.
    await computer.call('computer_click', { window: 77, element: 3 }, ctx())
    expect(ui.asked).toHaveLength(1)
  })

  it('opens a URL in the named app, or in the default browser without one', async () => {
    saved.computerAllowedApps = ['microsoft edge', 'the browser']
    await computer.call('computer_open', { app: 'Microsoft Edge', url: 'https://example.com' }, ctx())
    expect(fake.calls.find((c) => c.tool === 'launch_app')!.args).toEqual({ session: expect.any(String), name: 'Microsoft Edge', additional_arguments: ['https://example.com'] })
    await computer.call('computer_open', { url: 'https://example.com' }, ctx())
    expect(fake.calls.filter((c) => c.tool === 'launch_app').at(-1)!.args).toEqual({ session: expect.any(String), urls: ['https://example.com'] })
  })

  it('sends screenshots only when the model can see them', async () => {
    const blind = await computer.call('computer_look', { window: 77 }, ctx())
    expect(toolResultImages(blind)).toEqual([])
    expect(fake.calls.at(-1)!.args.include_screenshot).toBe(false)
    const seeing = await computer.call('computer_look', { window: 77 }, { ...ctx(), screenshots: true })
    expect(toolResultImages(seeing)).toEqual(['iVBOR'])
    expect(fake.calls.at(-1)!.args).toMatchObject({ include_screenshot: true, max_image_dimension: 1280 })
  })
})

describe('driver messages', () => {
  it("drop the driver's bookkeeping (pids, screen points, delivery paths), as seen on a real Paint drag", () => {
    expect(
      cleanMessage('✅ Posted drag to pid 47676 from window-pixel (630, 460) → (1090, 678), screen (631, 461) → (1091, 679) in 500ms / 20 steps.')
    ).toBe('Posted drag from window-pixel (630, 460) → (1090, 678) in 500ms / 20 steps.')
    expect(cleanMessage('Clicked at (600.0, 100.0) (delivery_mode=foreground, path=x11_xtest_fg); not verified — confirm with a screenshot. [window_point=(600, 100) screen_point=(770, 219)]')).toBe(
      'Clicked at (600.0, 100.0)'
    )
    // A foreground drag gives screen points only: they stay (a Llama Run chat showed "Sent drag via SendInput from in 500ms").
    expect(cleanMessage('Sent drag via SendInput from screen (679,570) → (1043,570) in 500ms / 20 steps (delivery_mode:foreground).')).toBe(
      'Sent drag via SendInput from screen (679,570) → (1043,570) in 500ms / 20 steps (delivery_mode:foreground).'
    )
  })
})

describe('things seen in Llama Run chats', () => {
  it('returns the browser window a URL opened in as a tab, instead of "its window hasn\'t appeared yet"', async () => {
    let opened = false
    const original = fake.call.bind(fake)
    fake.call = async (tool, args) => {
      if (tool === 'launch_app') {
        opened = true
        return { text: 'Launched', images: [], structured: { pid: 999 }, isError: false }
      }
      const r = await original(tool, args)
      if (tool === 'list_windows') {
        // Edge, already open: its title changes once the new tab loads.
        const edge = { app_name: 'msedge.exe', pid: 5, window_id: 50, title: opened ? 'Mixamo and 210 more pages - Personal - Microsoft Edge' : 'Sketchfab and 209 more pages - Personal - Microsoft Edge', width: 1900, height: 1200, z_index: 7, is_on_screen: true }
        r.structured = { windows: [...(r.structured!.windows as unknown[]), edge] }
      }
      return r
    }
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const open = computer.call('computer_open', { url: 'https://www.mixamo.com' }, ctx())
    await vi.advanceTimersByTimeAsync(1000)
    const r = await open
    vi.useRealTimers()
    expect(textOf(r)).toContain('Opened the browser')
    expect(fake.calls.find((c) => c.tool === 'get_window_state')!.args).toMatchObject({ pid: 5, window_id: 50 })
    // Allowed as "the browser" when opening: acting in that window doesn't ask again.
    await computer.call('computer_click', { window: 50, name: 'UPLOAD CHARACTER' }, ctx())
    expect(ui.asked).toHaveLength(1)
  })

  it('finds a heading with the text under it, not the heading alone', () => {
    const tree = [
      '- Window "Course"',
      '  - [16] Document "Assignment"',
      '    - Group "Tabs"',
      '      - [70] TabItem "Instructions"',
      '    - Group "Step-By-Step Assignment Instructions"',
      '      - [100] Text "Setup instructions:"',
      '      - Text "Pick a product and write a post for it."',
      '      - Text "Include a picture and a call to action."',
      '    - Group "Footer"',
      '      - [120] Hyperlink "Help"'
    ].join('\n')
    const found = findRows(tree, 'setup instructions')
    expect(found).toContain('Pick a product and write a post for it.')
    expect(found).toContain('Include a picture and a call to action.')
    expect(found).toContain('[16] Document "Assignment"')
    expect(found).not.toContain('Help')
    expect(found).not.toContain('TabItem')
    expect(findRows(tree, 'nowhere')).toBe('')
    // A match in a list of tabs stops at the next tab; one in the window's title doesn't pull in the whole window.
    const tabs = ['- Window "Billing - Edge"', '  - Tab "Tab bar"', '    - [5] TabItem "Billing"', '    - [6] TabItem "Mail"', '    - [7] TabItem "News"', '  - [8] Button "Back"'].join('\n')
    expect(findRows(tabs, 'billing')).toBe(['- Window "Billing - Edge"', '  - Tab "Tab bar"', '    - [5] TabItem "Billing"'].join('\n'))
  })

  it("reads the whole window for a find (a browser's tab strip fills the usual 250 rows)", async () => {
    saved.computerAllowedApps = ['notepad']
    const r = await computer.call('computer_look', { window: 77, find: 'save' }, ctx())
    const read = fake.calls.find((c) => c.tool === 'get_window_state')!.args
    expect(read.query).toBeUndefined()
    expect(read.max_elements).toBeGreaterThan(250)
    expect(textOf(r)).toContain('"Save"')
    expect(textOf(await computer.call('computer_look', { window: 77, find: 'zzz' }, ctx()))).toContain('No rows match "zzz"')
  })

  it('retries a row past the end of the latest read by its label, once, when nothing ran', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    fake.failNext = { 0: 'element_token_out_of_range' }
    const r = await computer.call('computer_click', { window: 77, element: 3 }, ctx())
    expect(fake.batches()).toHaveLength(2)
    expect(fake.lastBatch()).toEqual([{ tool: 'click', args: { name: 'Save', role: 'button' } }])
    expect(r.isError).toBeFalsy()
  })
})

describe('pixel positions', () => {
  it("refuses points outside the window's screenshot, as in a Llama Run chat that aimed from another image", async () => {
    saved.computerAllowedApps = ['notepad']
    const seeing = { ...ctx(), screenshots: true }
    const original = fake.call.bind(fake)
    fake.call = async (tool, args) => {
      const r = await original(tool, args)
      // The window's screenshot is 1280×804, like the maximised Edge window in that chat.
      if (tool === 'get_window_state' && args.include_screenshot) r.structured = { ...r.structured, screenshot_width: 1280, screenshot_height: 804 }
      return r
    }
    await computer.call('computer_look', { window: 77 }, seeing)
    const r = await computer.call('computer_drag', { window: 77, from_x: 676, from_y: 881, to_x: 865, to_y: 604, foreground: true }, seeing)
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('outside window 77')
    expect(textOf(r)).toContain('1280×804')
    expect(fake.batches()).toEqual([])
    await computer.call('computer_drag', { window: 77, from_x: 676, from_y: 717, to_x: 1010, to_y: 462 }, seeing)
    expect(fake.batches()).toHaveLength(1)
  })

  it("doesn't tell the model to retry in the foreground a drag that already was", async () => {
    saved.computerAllowedApps = ['notepad']
    const seeing = { ...ctx(), screenshots: true }
    await computer.call('computer_look', { window: 77 }, seeing)
    const original = fake.call.bind(fake)
    fake.call = async (tool, args) => {
      if (tool !== 'run_steps') return original(tool, args)
      fake.unchangedNext = ''
      const r = await original(tool, args)
      ;(r.structured!.steps as { message: string }[])[0].message = 'Sent drag via SendInput from screen (1,2) → (3,4) in 500ms / 20 steps (delivery_mode:foreground).'
      return r
    }
    const r = await computer.call('computer_drag', { window: 77, from_x: 1, from_y: 2, to_x: 3, to_y: 4, foreground: true }, seeing)
    expect(textOf(r)).not.toContain('retry the same drag with foreground')
    expect(textOf(r)).toContain('Check the screenshot')
  })
})

describe('key sequences', () => {
  it('presses a sequence in one batch, focusing the element with the first key', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    await computer.call('computer_key', { window: 77, element: 5, keys: 'down down enter' }, ctx())
    expect(fake.lastBatch()).toEqual([
      { tool: 'press_key', args: { key: 'down', element_token: 's00000001:5' } },
      { tool: 'press_key', args: { key: 'down' } },
      { tool: 'press_key', args: { key: 'return' } }
    ])
    expect(fake.batches()).toHaveLength(1)
  })

  it('expands sequences inside computer_steps, keeping wait_for on the first key and expect on the last', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    await computer.call(
      'computer_steps',
      { window: 77, steps: [{ action: 'key', keys: 'tab tab', wait_for: { name: 'Font' }, expect: [{ text: 'Bold' }] }, { action: 'click', name: 'Save' }] },
      ctx()
    )
    expect(fake.lastBatch()).toEqual([
      { tool: 'press_key', args: { key: 'tab' }, wait_for: { name: 'Font' } },
      { tool: 'press_key', args: { key: 'tab' }, expect: [{ text: 'Bold' }] },
      { tool: 'click', args: { name: 'Save' } }
    ])
  })
})

describe('windows that close', () => {
  it("recognises the driver's ways of saying a window is gone (Windows and X11)", async () => {
    const { isGone } = await import('../src/main/computer/tools')
    expect(isGone('Window target pid 293, window_id 29360135 is stale or no longer running; refresh list_windows.')).toBe(true)
    expect(isGone('X11 error X11Error { error_kind: Window, error_code: 3, request_name: Some("GetWindowAttributes") }')).toBe(true)
    expect(isGone('background_unavailable')).toBe(false)
  })

  it('forgets a window that closed and tells the model to list or reopen, instead of repeating the error', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    const original = fake.call.bind(fake)
    fake.call = async (tool, args) => {
      if (tool === 'get_window_state') return { text: 'Window target pid 42, window_id 77 is stale or no longer running; refresh list_windows.', images: [], isError: true }
      return original(tool, args)
    }
    const r = await computer.call('computer_look', { window: 77 }, ctx())
    expect(textOf(r)).toContain('has closed')
    expect(textOf(r)).toContain('computer_open')
  })
})

describe('drag and drop', () => {
  it('drags between elements by finding them in a fresh read with its screenshot, so the pixels match', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    // Blind model, element ends: allowed (nothing to guess).
    const r = await computer.call('computer_drag', { window: 77, from_element: 3, to_name: 'Text editor' }, ctx())
    expect(r.isError).toBeFalsy()
    const read = fake.calls.filter((c) => c.tool === 'get_window_state').at(-1)!
    expect(read.args).toMatchObject({ include_screenshot: true, tree_format: 'both', max_image_dimension: 1280 })
    // Row 3 sits at y 160..170, row 2 ("Text editor") at 140..150; centres of their screenshot frames.
    expect(fake.lastBatch()).toEqual([{ tool: 'drag', args: { from_x: 30, from_y: 165, to_x: 30, to_y: 145 } }])
  })

  it('refuses pixel ends a blind model would guess, and slows down on request', async () => {
    saved.computerAllowedApps = ['notepad']
    const blind = await computer.call('computer_drag', { window: 77, from_x: 1, from_y: 2, to_x: 3, to_y: 4 }, ctx())
    expect(blind.isError).toBe(true)
    expect(textOf(blind)).toContain('from_element')
    const seeing = { ...ctx(), screenshots: true }
    await computer.call('computer_look', { window: 77 }, seeing)
    await computer.call('computer_drag', { window: 77, from_x: 1, from_y: 2, to_x: 3, to_y: 4, slow: true }, seeing)
    expect(fake.lastBatch()).toEqual([{ tool: 'drag', args: { from_x: 1, from_y: 2, to_x: 3, to_y: 4, duration_ms: 1200, steps: 60 } }])
    // A drag's observation carries the screenshot that shows whether it landed.
    expect(fake.calls.at(-1)!.tool === 'run_steps' || fake.calls.some((c) => c.tool === 'run_steps' && (c.args.observe as { include_screenshot?: boolean }).include_screenshot)).toBe(true)
  })

  it("says when a drop wasn't confirmed, with the driver's hint, instead of reporting success", async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    fake.unchangedNext = 'The drag was posted but no drop was confirmed. Read what changed before repeating.'
    const r = await computer.call('computer_drag', { window: 77, from_element: 3, to_element: 2 }, ctx())
    const text = textOf(r)
    expect(text).toContain('(not confirmed)')
    expect(text).toContain('no drop was confirmed')
    // Canvases often ignore background drags (seen with Paint): the model is told how to make it land.
    expect(text).toContain('retry the same drag with foreground: true')
    expect(text).toContain('No visible change.')
    expect(text).not.toMatch(/window_point|confirm with a screenshot/)
  })

  it("doesn't replay a model's pixels on a window that changed: it shows the window again", async () => {
    saved.computerAllowedApps = ['notepad']
    const seeing = { ...ctx(), screenshots: true }
    await computer.call('computer_look', { window: 77 }, seeing)
    fake.failNext = { 0: 'screenshot_context_missing' }
    const r = await computer.call('computer_drag', { window: 77, from_x: 1, from_y: 2, to_x: 3, to_y: 4 }, seeing)
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('Aim again')
    expect(toolResultImages(r)).toEqual(['iVBOR'])
    expect(fake.batches()).toHaveLength(1)
  })

  it('moves windows with set_window_frame and drags inside batches', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_move_window', { window: 77, x: 0, y: 0, width: 800 }, ctx())
    expect(fake.calls.find((c) => c.tool === 'set_window_frame')!.args).toEqual({ session: expect.any(String), pid: 42, window_id: 77, x: 0, y: 0, width: 800 })
    const seeing = { ...ctx(), screenshots: true }
    await computer.call('computer_look', { window: 77 }, seeing)
    await computer.call('computer_steps', { window: 77, steps: [{ action: 'drag', x: 1, y: 2, to_x: 3, to_y: 4, expect: [{ text: 'Moved' }] }] }, seeing)
    expect(fake.lastBatch()).toEqual([{ tool: 'drag', args: { from_x: 1, from_y: 2, to_x: 3, to_y: 4 }, expect: [{ text: 'Moved' }] }])
  })
})

describe('safety', () => {
  it("never lists or acts on Llama Run's own windows (its approval cards)", async () => {
    const list = await computer.call('computer_windows', {}, ctx())
    expect(textOf(list)).not.toContain('99:')
    const r = await computer.call('computer_click', { window: 99, name: 'Always allow' }, ctx())
    expect(r.isError).toBe(true)
    expect(fake.batches()).toEqual([])
  })

  it('opens only web pages by URL, and shows arguments in the question, every time for shells', async () => {
    const file = await computer.call('computer_open', { url: 'C:\\Users\\me\\evil.bat' }, ctx())
    expect(file.isError).toBe(true)
    expect(fake.calls.some((c) => c.tool === 'launch_app')).toBe(false)

    saved.computerAllowedApps = ['cmd']
    await computer.call('computer_open', { app: 'cmd', args: ['/c', 'del', 'x'] }, ctx())
    expect(ui.asked).toHaveLength(1)
    expect(ui.asked[0].command).toBe('cmd /c del x')
    expect(saved.computerAllowedApps).toEqual(['cmd'])
    // Again: asked again, though cmd is "always allowed".
    await computer.call('computer_open', { app: 'cmd', args: ['/c', 'dir'] }, ctx())
    expect(ui.asked).toHaveLength(2)
  })

  it('only grants the window the launch produced, never another one that appeared meanwhile', async () => {
    fake.calls = []
    const original = fake.call.bind(fake)
    fake.call = async (tool, args) => {
      if (tool === 'launch_app') return { text: 'Launched', images: [], structured: { pid: 500 }, isError: false }
      return original(tool, args)
    }
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const opened = computer.call('computer_open', { app: 'Paint' }, ctx())
    await vi.advanceTimersByTimeAsync(6000)
    const r = await opened
    vi.useRealTimers()
    // Notepad (pid 42) was already open; nothing of pid 500 or named Paint appeared.
    expect(textOf(r)).toContain("hasn't appeared")
    await computer.call('computer_click', { window: 77, name: 'Save' }, ctx())
    expect(ui.asked.map((a) => a.title)).toEqual(['Let Llama Run control Paint?', 'Let Llama Run control Notepad?'])
  })

  it("finds a launched window's real process when launch_app leaves it out (Store apps live in a host process)", async () => {
    const original = fake.call.bind(fake)
    fake.call = async (tool, args) => {
      if (tool === 'launch_app') return { text: 'Launched', images: [], structured: { pid: 900, windows: [{ window_id: 12, title: 'Calculator' }] }, isError: false }
      return original(tool, args)
    }
    const r = await computer.call('computer_open', { app: 'Calculator' }, ctx())
    expect(textOf(r)).toContain('Opened Calculator')
    // Read with the host process's pid from the window list (7), never the launched pid or none.
    expect(fake.calls.find((c) => c.tool === 'get_window_state')!.args).toMatchObject({ pid: 7, window_id: 12 })
  })

  it('asks before typing into a field named like a password, by name as well as by row', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    await computer.call('computer_type', { window: 77, name: 'Password', text: 'hunter2' }, ctx())
    expect(ui.asked).toHaveLength(1)
    expect(ui.asked[0].title).toContain('password')
  })

  it('lets one chat use the computer at a time', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_windows', {}, ctx())
    const other = await computer.call('computer_windows', {}, { chatId: 'someone-else' })
    expect(other.isError).toBe(true)
    expect(textOf(other)).toContain('Another chat')
    computer.endTurn(ctx().chatId)
    expect(fake.calls.at(-1)).toMatchObject({ tool: 'end_session', args: { session: `llamarun-chat${chat}` } })
    const after = await computer.call('computer_windows', {}, { chatId: 'someone-else' })
    expect(after.isError).toBeFalsy()
    computer.endTurn('someone-else')
  })
})

describe('staying on track and keeping requests small', () => {
  it('reports windows that opened since the last list with the action, so no extra look is needed', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_windows', {}, ctx())
    await computer.call('computer_look', { window: 77 }, ctx())
    fake.opensNext = [{ app_name: 'Notepad', pid: 42, window_id: 78, title: 'Save As', width: 400, height: 300, z_index: 9, is_on_screen: true }]
    const r = await computer.call('computer_key', { window: 77, keys: 'ctrl+shift+s' }, ctx())
    expect(textOf(r)).toContain('New window 78: Notepad — "Save As"')
  })

  it('refuses the same futile action a third time and tells the model to change course', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    for (let i = 0; i < 2; i++) {
      fake.unchangedNext = ''
      await computer.call('computer_click', { window: 77, name: 'Nothing' }, ctx())
    }
    const sent = fake.batches().length
    const third = await computer.call('computer_click', { window: 77, name: 'Nothing' }, ctx())
    expect(third.isError).toBe(true)
    expect(textOf(third)).toContain('different way')
    expect(fake.batches()).toHaveLength(sent)
  })

  it('pastes long text instead of typing it key by key, and gives the user their clipboard back', async () => {
    saved.computerAllowedApps = ['notepad']
    const seeing = { ...ctx(), screenshots: true }
    await computer.call('computer_look', { window: 77 }, seeing)
    const long = 'x'.repeat(500)
    const r = await computer.call('computer_type', { window: 77, x: 5, y: 6, text: long }, seeing)
    expect(fake.lastBatch()).toEqual([
      { tool: 'click', args: { x: 5, y: 6 } },
      { tool: 'hotkey', args: { keys: ['ctrl', 'v'] } }
    ])
    expect(textOf(r)).toContain('Pasted 500 characters')
    expect(fake.clipboard).toBe('user copied this')
  })

  it('cuts window and app lists from later requests once a newer one arrives', async () => {
    const list = await computer.call('computer_windows', {}, ctx())
    expect(list.superseded).toBeTruthy()
  })

  it('stops a running batch when the user presses Stop', async () => {
    saved.computerAllowedApps = ['notepad']
    let release!: () => void
    const original = fake.call.bind(fake)
    fake.call = async (tool, args) => {
      if (tool === 'run_steps') await new Promise<void>((done) => (release = done))
      return original(tool, args)
    }
    await computer.call('computer_look', { window: 77 }, ctx())
    const running = computer.call('computer_click', { window: 77, name: 'Save' }, ctx())
    await new Promise((done) => setTimeout(done, 10))
    await computer.cancel(ctx().chatId)
    expect(fake.restarts).toBe(1)
    release()
    await running
  })
})

describe('SupersededResults', () => {
  it('cuts older window states to their short form when a newer one arrives', () => {
    const log = new SupersededResults()
    const messages = ['first state', 'plain tool result', 'second state']
    log.add({ content: [], superseded: 'first (old)' }, (t) => (messages[0] = t))
    log.add({ content: [] }, (t) => (messages[1] = t))
    expect(messages[0]).toBe('first state')
    log.add({ content: [], superseded: 'second (old)' }, (t) => (messages[2] = t))
    expect(messages).toEqual(['first (old)', 'plain tool result', 'second state'])
  })
})

describe('loading the SDK in the worker', async () => {
  const { sdkSpecifier } = await import('../src/main/computer/protocol')
  it('uses the package name in development and the unpacked copy when installed', () => {
    expect(sdkSpecifier('/home/me/LlamaRun/out/main')).toBe('@trycua/cua-driver')
    // Paths as the platform running the test writes them (a POSIX path on Windows would gain the drive letter).
    const installed = process.platform === 'win32' ? 'C:\\Program Files\\Llama Run\\resources\\app.asar\\out\\main' : '/opt/Llama Run/resources/app.asar/out/main'
    const unpacked = process.platform === 'win32' ? 'file:///C:/Program%20Files/Llama%20Run/resources' : 'file:///opt/Llama%20Run/resources'
    expect(sdkSpecifier(installed)).toBe(`${unpacked}/app.asar.unpacked/node_modules/@trycua/cua-driver/dist/index.js`)
  })
})

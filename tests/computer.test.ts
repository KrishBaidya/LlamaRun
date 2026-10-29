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

const { computer, parseKeys, rowsOf, cleanDiff, appLabel, COMPUTER_TOOLS } = await import('../src/main/computer/tools')
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
    return { images, structured: { snapshot_id: id, window_id: 77, pid: 42, window_title: 'Untitled - Notepad', tree_markdown: TREE, element_count: 6 } }
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
            { app_name: 'Helper', pid: 3, window_id: 13, title: 'hidden', width: 100, height: 100, z_index: 2, is_on_screen: false }
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
        for (const [i, step] of steps.entries()) {
          const code = this.failNext[i]
          if (code) {
            results.push({ index: i, ok: false, code, phase: 'action', message: `${step.tool} refused`, tool: step.tool })
            break
          }
          results.push({ index: i, ok: true, message: `${step.tool} done`, tool: step.tool })
        }
        this.failNext = {}
        const observe = args.observe as Record<string, unknown>
        const s = this.state({ ...observe, since: 'latest' })
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
      default:
        return ok(`${tool} done`)
    }
  }

  async close(): Promise<void> {}

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
    expect(fake.calls.at(-1)!.args).toMatchObject({ max_elements: 400, timeout_ms: 3000 })

    const r = await computer.call('computer_click', { window: 77, element: 3 }, ctx())
    expect(r.isError).toBeFalsy()
    const batch = fake.calls.at(-1)!
    expect(batch.tool).toBe('run_steps')
    expect(batch.args).toMatchObject({ pid: 42, window_id: 77, observe: { include_screenshot: false, max_elements: 400, timeout_ms: 3000 } })
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

  it('takes a screenshot frame before the first pixel action, keeping rows valid', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    await computer.call('computer_click', { window: 77, x: 10, y: 20 }, ctx())
    const frame = fake.calls.find((c) => c.tool === 'get_window_state' && c.args.include_accessibility_tree === false)
    expect(frame?.args).toMatchObject({ pid: 42, window_id: 77, include_screenshot: true })
    expect(fake.lastBatch()).toEqual([{ tool: 'click', args: { x: 10, y: 20 } }])
    // Only once per window.
    await computer.call('computer_click', { window: 77, x: 30, y: 40 }, ctx())
    expect(fake.calls.filter((c) => c.args.include_accessibility_tree === false)).toHaveLength(1)
  })

  it('passes refusals on with what to do, and retries in the foreground only when asked', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    fake.failNext = { 0: 'background_unavailable' }
    const refused = await computer.call('computer_click', { window: 77, element: 3 }, ctx())
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('foreground: true')
    await computer.call('computer_click', { window: 77, element: 3, foreground: true }, ctx())
    expect(fake.calls.at(-1)!.args).toMatchObject({ delivery_mode: 'foreground' })
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
    const typing = process.platform === 'win32' ? { text: 'hello', delay_ms: 10 } : { text: 'hello' }
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
    expect(fake.calls.find((c) => c.tool === 'invoke_menu')!.args).toEqual({ pid: 42, window_id: 77, path: ['File', 'Save'] })
    expect(textOf(r)).toContain('Invoked File > Save')
    expect(fake.calls.at(-1)).toMatchObject({ tool: 'get_window_state', args: { since: 's00000001' } })
  })

  it('opens an app using the window launch_app reports, and reads it', async () => {
    const r = await computer.call('computer_open', { app: 'Notepad' }, ctx())
    expect(fake.calls.find((c) => c.tool === 'launch_app')!.args).toEqual({ name: 'Notepad' })
    expect(textOf(r)).toContain('[3] button "Save"')
    // Allowed by name when opening; acting in its window doesn't ask again.
    await computer.call('computer_click', { window: 77, element: 3 }, ctx())
    expect(ui.asked).toHaveLength(1)
  })

  it('opens a URL in the named app, or in the default browser without one', async () => {
    saved.computerAllowedApps = ['microsoft edge', 'the browser']
    await computer.call('computer_open', { app: 'Microsoft Edge', url: 'https://example.com' }, ctx())
    expect(fake.calls.find((c) => c.tool === 'launch_app')!.args).toEqual({ name: 'Microsoft Edge', additional_arguments: ['https://example.com'] })
    await computer.call('computer_open', { url: 'https://example.com' }, ctx())
    expect(fake.calls.filter((c) => c.tool === 'launch_app').at(-1)!.args).toEqual({ urls: ['https://example.com'] })
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
    expect(sdkSpecifier('/opt/Llama Run/resources/app.asar/out/main')).toBe(
      'file:///opt/Llama%20Run/resources/app.asar.unpacked/node_modules/@trycua/cua-driver/dist/index.js'
    )
  })
})

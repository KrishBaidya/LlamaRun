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

const { computer, parseKeys, rowsOf, COMPUTER_TOOLS } = await import('../src/main/computer/tools')
const { setDriverTransport } = await import('../src/main/computer/driver')
const { settings } = await import('../src/main/settings')
const { SupersededResults, toolResultImages, toolResultToText } = await import('../src/main/llm/toolPayload')
import type { DriverResult } from '../src/main/computer/protocol'

const TREE = ['- [0] window "Untitled - Notepad"', '  - [1] menu item "File"', '  - [2] document "Text editor"', '  - [3] button "Save"', '  - [4] edit "Password"'].join('\n')

/** A pretend Cua Driver: one Notepad window, a numbered tree, and actions that succeed. */
class FakeDriver {
  calls: { tool: string; args: Record<string, unknown> }[] = []
  private snapshot = 0

  async call(tool: string, args: Record<string, unknown>): Promise<DriverResult> {
    this.calls.push({ tool, args })
    const ok = (text: string, structured: Record<string, unknown> = {}): DriverResult => ({ text, images: [], structured, isError: false })
    switch (tool) {
      case 'list_windows':
        return ok('2 windows', {
          windows: [
            { app_name: 'Explorer', pid: 1, window_id: 10, title: 'Downloads', width: 800, height: 600, z_index: 1 },
            { app_name: 'Notepad', pid: 42, window_id: 77, title: 'Untitled - Notepad', width: 800, height: 600, z_index: 5 },
            { app_name: 'Tray', pid: 2, window_id: 11, title: '', width: 1, height: 1, z_index: 9 }
          ]
        })
      case 'get_window_state': {
        const id = `s${String(++this.snapshot).padStart(8, '0')}`
        if (args.since) {
          return ok('diff', {
            snapshot_id: id,
            since: args.since,
            since_status: 'changed',
            tree_diff: `1 change since ${String(args.since)}. use snapshot_id ${id} in element_tokens (${id}:N).\n+ [5] dialog "Save as"\nInvalidated snapshots ${String(args.since)}: their element_tokens are stale.`
          })
        }
        return {
          ...ok('tree', { snapshot_id: id, window_title: 'Untitled - Notepad', tree_markdown: TREE, element_count: 5 }),
          images: args.include_screenshot ? [{ mimeType: 'image/png', data: 'iVBOR' }] : []
        }
      }
      case 'launch_app':
        return ok('Launched notepad', { pid: 42 })
      default:
        return ok(`${tool} done`, { summary: `${tool} done`, effect: 'confirmed' })
    }
  }

  async close(): Promise<void> {}

  actions(): string[] {
    return this.calls.map((c) => c.tool).filter((t) => t !== 'list_windows' && t !== 'get_window_state')
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
    expect(parseKeys('Enter')).toEqual({ tool: 'press_key', args: { key: 'enter' } })
    expect(parseKeys('esc')).toEqual({ tool: 'press_key', args: { key: 'escape' } })
    expect(parseKeys('Control+Shift+S')).toEqual({ tool: 'hotkey', args: { keys: ['ctrl', 'shift', 's'] } })
    expect(() => parseKeys(' + ')).toThrow()
  })

  it('reads row numbers from a tree', () => {
    expect(rowsOf(TREE).get(3)).toBe('- [3] button "Save"')
  })

  it('keeps the tool list small', () => {
    expect(COMPUTER_TOOLS.length).toBeLessThanOrEqual(12)
    expect(COMPUTER_TOOLS.every((t) => t.name.startsWith('computer_'))).toBe(true)
  })
})

describe('computer use tools', () => {
  it('lists real windows front first, without zero-size ones', async () => {
    const r = await computer.call('computer_windows', {}, ctx())
    const text = textOf(r)
    expect(text.indexOf('77: Notepad')).toBeLessThan(text.indexOf('10: Explorer'))
    expect(text).not.toContain('Tray')
  })

  it('needs a look before acting on a row', async () => {
    await computer.call('computer_windows', {}, ctx())
    const r = await computer.call('computer_click', { window: 10, element: 3 }, ctx())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('computer_look')
    expect(fake.actions()).toEqual([])
  })

  it('clicks by row, asks once per app per reply, and returns what changed', async () => {
    const look = await computer.call('computer_look', { window: 77 }, ctx())
    expect(textOf(look)).toContain('[3] button "Save"')
    expect(look.superseded).toBeDefined()

    const r = await computer.call('computer_click', { window: 77, element: 3 }, ctx())
    expect(r.isError).toBeFalsy()
    const click = fake.calls.find((c) => c.tool === 'click')!
    expect(click.args).toMatchObject({ pid: 42, window_id: 77, element_token: 's00000001:3', button: 'left' })
    expect(click.args).not.toHaveProperty('delivery_mode')
    // Observed straight after, as a diff against the last look.
    expect(fake.calls.at(-1)).toMatchObject({ tool: 'get_window_state', args: { since: 's00000001' } })
    const text = textOf(r)
    expect(text).toContain('click done')
    expect(text).toContain('[5] dialog "Save as"')
    expect(text).not.toMatch(/element_token|snapshot_id|Invalidated/)
    expect(r.superseded).toContain('click done')
    expect(ui.asked).toHaveLength(1)
    expect(ui.asked[0].title).toContain('Notepad')
    expect(ui.using).toEqual([[`chat-${chat}`, 'Notepad']])

    // Same reply, same app: no second question. Rows now refer to the newer snapshot.
    await computer.call('computer_key', { window: 77, keys: 'ctrl+s' }, ctx())
    expect(ui.asked).toHaveLength(1)
    expect(fake.calls.find((c) => c.tool === 'hotkey')!.args).toMatchObject({ keys: ['ctrl', 's'] })

    // Next reply asks again.
    computer.endTurn(`chat-${chat}`)
    expect(ui.done).toContain(`chat-${chat}`)
    await computer.call('computer_key', { window: 77, keys: 'enter' }, ctx())
    expect(ui.asked).toHaveLength(2)
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
    const r = await computer.call('computer_type', { window: 77, text: 'hi' }, ctx())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain("didn't allow")
    expect(fake.actions()).toEqual([])
  })

  it('refuses blocked apps without asking', async () => {
    saved.computerBlockedApps = ['notepad.exe']
    await computer.call('computer_look', { window: 77 }, ctx())
    const r = await computer.call('computer_click', { window: 77, x: 5, y: 5 }, ctx())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('blocked')
    expect(ui.asked).toHaveLength(0)
    expect(fake.actions()).toEqual([])
  })

  it('asks every time before typing into a password field', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    await computer.call('computer_type', { window: 77, element: 2, text: 'notes' }, ctx())
    expect(ui.asked).toHaveLength(0)
    await computer.call('computer_type', { window: 77, element: 4, text: 'hunter2' }, ctx())
    expect(ui.asked).toHaveLength(1)
    expect(ui.asked[0].title).toContain('password')
  })

  it('types with set_value when replacing, and submits in one batch', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_look', { window: 77 }, ctx())
    await computer.call('computer_type', { window: 77, element: 2, text: 'new text', replace: true }, ctx())
    expect(fake.calls.find((c) => c.tool === 'set_value')!.args).toMatchObject({ value: 'new text', element_token: 's00000001:2' })
    await computer.call('computer_type', { window: 77, element: 2, text: 'more', submit: true }, ctx())
    expect(fake.actions()).toEqual(['set_value', 'run_steps'])
    expect(fake.calls.find((c) => c.tool === 'run_steps')!.args.steps).toEqual([
      { tool: 'type_text', args: { element_token: 's00000002:2', text: 'more' } },
      { tool: 'press_key', args: { key: 'enter' } }
    ])
  })

  it('retries in the foreground only when asked to', async () => {
    saved.computerAllowedApps = ['notepad']
    await computer.call('computer_click', { window: 77, x: 10, y: 20, foreground: true }, ctx())
    expect(fake.calls.find((c) => c.tool === 'click')!.args).toMatchObject({ x: 10, y: 20, delivery_mode: 'foreground' })
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
          { action: 'click', element: 3, clicks: 2 }
        ]
      },
      ctx()
    )
    expect(r.isError).toBeFalsy()
    expect(fake.actions()).toEqual(['run_steps'])
    expect(fake.calls.find((c) => c.tool === 'run_steps')!.args).toEqual({
      pid: 42,
      window_id: 77,
      steps: [
        { tool: 'click', args: { element_token: 's00000001:2' } },
        { tool: 'type_text', args: { text: 'hello' } },
        { tool: 'hotkey', args: { keys: ['ctrl', 's'] } },
        { tool: 'click', args: { element_token: 's00000001:3', count: 2 } }
      ]
    })
  })

  it('opens an app, waits for its window and reads it', async () => {
    const r = await computer.call('computer_open', { app: 'notepad' }, ctx())
    expect(fake.calls.find((c) => c.tool === 'launch_app')!.args).toEqual({ name: 'notepad' })
    expect(textOf(r)).toContain('[3] button "Save"')
    // Allowed by name when opening; acting in its window doesn't ask again.
    await computer.call('computer_click', { window: 77, element: 3 }, ctx())
    expect(ui.asked).toHaveLength(1)
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

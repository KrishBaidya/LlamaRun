import { afterAll, describe, expect, it, vi } from 'vitest'

/**
 * Computer use against the real Cua Driver (in this process, no Electron).
 * Opt-in, since it opens and drives real apps on the desktop:
 *
 *   CUA_E2E=1 npx vitest run tests/computer.e2e.test.ts
 *
 * Windows uses Calculator and Notepad. Linux needs a desktop session with the
 * accessibility bus (e.g. `dbus-run-session` under `xvfb-run`) and
 * gnome-calculator and mousepad.
 */

vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  globalShortcut: { register: () => true, unregister: () => {} },
  BrowserWindow: class {},
  dialog: {},
  screen: {},
  utilityProcess: {}
}))
vi.mock('../src/main/assistant/approval', () => ({ askApproval: async () => 'once' }))
vi.mock('../src/main/computer/indicator', () => ({ indicator: { using: () => {}, done: () => {}, on: () => {} } }))

const windows = process.platform === 'win32'
const apps = windows
  ? { calculator: 'Calculator', editor: 'Notepad', keys: ['Six', 'Multiply by', 'Seven', 'Equals'] }
  : { calculator: 'gnome-calculator', editor: 'mousepad', keys: ['6', '×', '7', '='] }

describe.skipIf(!process.env.CUA_E2E)('computer use with the real Cua Driver', async () => {
  const { CuaDriver } = await import('@trycua/cua-driver')
  const { toDriverResult } = await import('../src/main/computer/protocol')
  const { setDriverTransport } = await import('../src/main/computer/driver')
  const { computer } = await import('../src/main/computer/tools')
  const { settings } = await import('../src/main/settings')
  const { toolResultToText } = await import('../src/main/llm/toolPayload')

  vi.spyOn(settings, 'get').mockImplementation((() => []) as typeof settings.get)
  const native = CuaDriver.create()
  const timings: string[] = []
  setDriverTransport({
    call: async (tool, args) => {
      const start = performance.now()
      const r = toDriverResult(await native.callTool(tool, JSON.stringify(args)))
      timings.push(`${tool} ${Math.round(performance.now() - start)} ms`)
      return r
    },
    close: () => native.shutdown()
  })
  const ctx = { chatId: 'e2e' }
  const text = (r: { content: unknown[] }): string => toolResultToText({ content: r.content })
  const opened: number[] = []
  const open = async (app: string): Promise<number> => {
    const r = await computer.call('computer_open', { app }, ctx)
    console.log(text(r).slice(0, 1500))
    expect(r.isError).toBeFalsy()
    const id = Number(/Window (\d+):/.exec(text(r))?.[1])
    expect(id).toBeGreaterThan(0)
    opened.push(id)
    return id
  }

  afterAll(async () => {
    console.log(`driver calls:\n${timings.join('\n')}`)
    // Close what it opened (unsaved, so kill rather than ask it to quit).
    const listed = toDriverResult(await native.callTool('list_windows', '{}'))
    for (const w of (listed.structured?.windows as { window_id: number; pid: number }[] | undefined) ?? []) {
      if (opened.includes(w.window_id)) await native.callTool('kill_app', JSON.stringify({ pid: w.pid })).catch(() => {})
    }
    await native.shutdown()
  })

  it('works a calculator by button names in one batch, and sees the result in the same call', async () => {
    const window = await open(apps.calculator)
    const before = timings.length
    const r = await computer.call('computer_steps', { window, steps: apps.keys.map((name) => ({ action: 'click', name, role: 'button' })) }, ctx)
    console.log(text(r))
    expect(r.isError).toBeFalsy()
    // One driver call: the clicks and the look at what changed.
    expect(timings.slice(before).map((t) => t.split(' ')[0])).toEqual(['run_steps'])
    expect(text(r)).toContain('42')
  }, 60_000)

  it('types into a text editor by row and reads it back', async () => {
    const window = await open(apps.editor)
    const look = await computer.call('computer_look', { window }, ctx)
    const row = /\[(\d+)\] (?:document|text|edit)\b[^\n]*/i.exec(text(look))
    expect(row, 'an editable text area in the tree').not.toBeNull()
    const typed = await computer.call('computer_type', { window, element: Number(row![1]), text: 'typed by llamarun' }, ctx)
    console.log(text(typed))
    expect(typed.isError).toBeFalsy()
    const check = await computer.call('computer_look', { window, find: 'typed by llamarun' }, ctx)
    expect(text(check)).toContain('typed by llamarun')
  }, 60_000)

  it('clicks a point after taking the screenshot frame it needs', async () => {
    const window = opened[0]
    const r = await computer.call('computer_click', { window, x: 20, y: 20 }, ctx)
    console.log(text(r))
    expect(text(r)).not.toContain('screenshot_context_missing')
  }, 30_000)
})

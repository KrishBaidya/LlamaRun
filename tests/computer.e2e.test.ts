import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

/**
 * Computer use against the real Cua Driver (in this process, no Electron).
 * Opt-in, since it opens and types into a real app on the desktop:
 *
 *   CUA_E2E=1 npx vitest run tests/computer.e2e.test.ts
 *
 * Windows uses Notepad. Linux needs a display (e.g. `xvfb-run`) and xterm.
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
const out = join(tmpdir(), 'llamarun-cua-e2e.txt')

describe.skipIf(!process.env.CUA_E2E)('computer use with the real Cua Driver', async () => {
  const { CuaDriver } = await import('@trycua/cua-driver')
  const { toDriverResult } = await import('../src/main/computer/protocol')
  const { setDriverTransport } = await import('../src/main/computer/driver')
  const { computer } = await import('../src/main/computer/tools')
  const { settings } = await import('../src/main/settings')
  const { toolResultToText } = await import('../src/main/llm/toolPayload')

  vi.spyOn(settings, 'get').mockImplementation((() => []) as typeof settings.get)
  const native = CuaDriver.create()
  setDriverTransport({
    call: async (tool, args) => toDriverResult(await native.callTool(tool, JSON.stringify(args))),
    close: () => native.shutdown()
  })
  const ctx = { chatId: 'e2e' }
  const text = (r: { content: unknown[] }): string => toolResultToText({ content: r.content })
  let window = 0

  afterAll(async () => {
    // Close the app it opened (unsaved, so kill rather than ask it to quit).
    const listed = toDriverResult(await native.callTool('list_windows', '{}'))
    const ours = (listed.structured?.windows as { window_id: number; pid: number }[] | undefined)?.find((w) => w.window_id === window)
    if (ours) await native.callTool('kill_app', JSON.stringify({ pid: ours.pid })).catch(() => {})
    await native.shutdown()
    rmSync(out, { force: true })
  })

  it('opens the app and reads its window', async () => {
    const r = await computer.call('computer_open', { app: windows ? 'notepad' : 'xterm' }, ctx)
    console.log(text(r))
    expect(r.isError).toBeFalsy()
    window = Number(/Window (\d+):/.exec(text(r))?.[1])
    expect(window).toBeGreaterThan(0)
  }, 20_000)

  it('lists the window', async () => {
    const r = await computer.call('computer_windows', {}, ctx)
    expect(text(r)).toContain(`${window}:`)
  })

  it('types and presses keys, returning what changed', async () => {
    rmSync(out, { force: true })
    const line = windows ? 'typed by llamarun' : `echo typed-by-llamarun > ${out}`
    const typed = await computer.call('computer_type', { window, text: line, submit: !windows }, ctx)
    console.log(text(typed))
    expect(typed.isError).toBeFalsy()
    expect(text(typed)).toContain(`Window ${window}`)
    if (!windows) {
      await new Promise((done) => setTimeout(done, 500))
      expect(existsSync(out) && readFileSync(out, 'utf8').trim()).toBe('typed-by-llamarun')
    } else {
      const look = await computer.call('computer_look', { window, find: 'typed by llamarun' }, ctx)
      expect(text(look)).toContain('typed by llamarun')
    }
  }, 20_000)

  it('runs a batch of steps', async () => {
    const r = await computer.call(
      'computer_steps',
      { window, steps: [{ action: 'type', text: windows ? ' and steps' : ' # steps' }, { action: 'key', keys: windows ? 'ctrl+a' : 'ctrl+u' }] },
      ctx
    )
    console.log(text(r))
    expect(r.isError).toBeFalsy()
  }, 20_000)
})

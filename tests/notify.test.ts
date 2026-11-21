import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-notify-'))
const shown: { title: string; body: string }[] = []
let focused: object | null = null

vi.mock('electron', () => {
  class Notification {
    static isSupported = (): boolean => true
    constructor(private opts: { title: string; body: string }) {}
    on(): void {}
    show(): void {
      shown.push({ title: this.opts.title, body: this.opts.body })
    }
  }
  return {
    app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
    BrowserWindow: { getFocusedWindow: () => focused, getAllWindows: () => [] },
    Notification,
    dialog: {},
    nativeTheme: { on: () => undefined, shouldUseDarkColors: false }
  }
})
vi.mock('../src/main/windows/chat', () => ({ openChatWindow: () => undefined }))

const notify = await import('../src/main/notify')
const { approvals } = await import('../src/main/assistant/approval')
const { settings } = await import('../src/main/settings')
notify.startApprovalNotices(() => 'Report')

beforeEach(() => {
  shown.length = 0
  focused = null
  settings.set({ notifyWhenDone: true })
})

describe('notify when done', () => {
  it('tells the user a reply finished only while they are elsewhere', () => {
    notify.replyFinished('c1', 'Report', 'done', '**Saved** the PDF to Downloads.')
    expect(shown).toEqual([{ title: 'Report: done', body: 'Saved the PDF to Downloads.' }])
    focused = {}
    notify.replyFinished('c1', 'Report', 'done', 'again')
    expect(shown).toHaveLength(1)
  })

  it('reports failures, and can be turned off', () => {
    notify.replyFinished('c1', 'Report', 'error', '', 'Network down')
    expect(shown[0]).toEqual({ title: 'Report: something went wrong', body: 'Network down' })
    settings.set({ notifyWhenDone: false })
    notify.replyFinished('c1', 'Report', 'done', 'x')
    expect(shown).toHaveLength(1)
  })

  it('notifies once for an approval, never for unattended chats', async () => {
    const pending = approvals.ask('c2', { title: 'Run this command on your computer?', command: 'pip install x', detail: '', alwaysLabel: '' })
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(shown).toEqual([{ title: 'Report needs you', body: 'Run this command on your computer? pip install x' }])
    approvals.cancelChat('c2')
    await pending
    approvals.unattended.add('c3')
    await approvals.ask('c3', { title: 'Run?', command: 'x', detail: '', alwaysLabel: '' })
    expect(shown).toHaveLength(1)
  })
})

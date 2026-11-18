import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-quiet-'))
const shown: string[] = []
vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  Notification: class {
    constructor(private o: { body: string }) {}
    on(): void {}
    show(): void {
      shown.push(this.o.body)
    }
  },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  nativeImage: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../src/main/windows/chat', () => ({ openChatWindow: () => undefined }))

/** What the fake run does: maybe call notify_user, then reply. */
const run = vi.hoisted(() => ({ notify: null as string | null }))
vi.mock('../src/main/chats/service', async () => {
  const { callBuiltinTool } = await import('../src/main/assistant/builtins')
  return {
    chatService: {
      ask: (_chatId: string | null) => ({
        chatId: 'routine-chat',
        done: (async () => {
          if (run.notify) await callBuiltinTool('notify_user', { text: run.notify }, { chatId: 'routine-chat' })
          return { status: 'done', content: 'Nothing new on the page.' }
        })()
      })
    }
  }
})

const { runRoutine } = await import('../src/main/routines/scheduler')
const { routineStore } = await import('../src/main/routines/store')
const { builtinTools } = await import('../src/main/assistant/builtins')

beforeEach(() => {
  shown.length = 0
  run.notify = null
})

describe('quiet routines', () => {
  it('offers notify_user only in routine runs', () => {
    expect(builtinTools({ shell: true, routine: true }).map((t) => t.name)).toContain('notify_user')
    expect(builtinTools({ shell: true }).map((t) => t.name)).not.toContain('notify_user')
  })

  it('a quiet routine stays silent unless the run calls notify_user', async () => {
    const r = routineStore.add('check the price', 'every 2h', undefined, true)
    await runRoutine(r)
    expect(shown).toEqual([])
    run.notify = 'The price dropped to 499.'
    await runRoutine(routineStore.get(r.id)!)
    expect(shown).toEqual(['The price dropped to 499.'])
  })

  it('a normal routine still notifies with its reply', async () => {
    const r = routineStore.add('summarise the news', 'daily 9:00')
    await runRoutine(r)
    expect(shown).toEqual(['Nothing new on the page.'])
  })
})

import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-queue-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  globalShortcut: { register: () => true, unregister: () => {} },
  BrowserWindow: class {},
  dialog: {},
  Notification: class {},
  safeStorage: {},
  screen: {},
  shell: {},
  utilityProcess: {}
}))

/** Each reply the fake model gives: what it sees, and a script. */
const model = vi.hoisted(() => ({ calls: [] as { input: unknown; steered: string[] }[], gate: null as null | Promise<void> }))
vi.mock('../src/main/llm', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/llm')>()
  return {
    ...real,
    modelCatalog: async () => ({ groups: [], ollamaRunning: false }),
    generate: async (input: unknown, opts: Record<string, unknown>) => {
      const call = { input, steered: [] as string[] }
      model.calls.push(call)
      if (model.calls.length === 1) {
        // Round 1 runs a tool while the user types; between rounds the loop asks for steers.
        await model.gate
        const note = (opts.steer as () => string | undefined)()
        if (note) call.steered.push(note)
        return 'first reply'
      }
      return 'second reply'
    }
  }
})

const { chatService } = await import('../src/main/chats/service')
const { pluginHost } = await import('../src/main/plugins/host')

describe('queued and steered messages', () => {
  it('steers one into the running reply and sends the rest when it ends', async () => {
    vi.spyOn(pluginHost, 'beforeTextGeneration').mockImplementation(async (text: string) => ({ cancel: false, input_text: text, model: '' }) as never)
    vi.spyOn(pluginHost, 'afterTextGeneration').mockImplementation(async (_i, response) => ({ response_text: response }) as never)
    let open!: () => void
    model.gate = new Promise<void>((r) => (open = r))
    const chatId = await chatService.send(null, 'make the report', 'm')
    await new Promise((r) => setTimeout(r, 20))

    chatService.queue(chatId, 'use A4 paper')
    chatService.queue(chatId, 'then email it')
    const [first, second] = chatService.queuedFor(chatId)
    chatService.steer(chatId, first.id)
    expect(chatService.queuedFor(chatId)).toEqual([{ ...first, steer: true }, second])
    open()

    await vi.waitFor(() => expect(model.calls).toHaveLength(2))
    expect(model.calls[0].steered).toEqual(['use A4 paper'])
    const chat = chatService.get(chatId)!
    await vi.waitFor(() => expect(chatService.get(chatId)!.messages.at(-1)?.status).toBe('done'))
    // The steer shows in the first reply where the model got it; the other went as the next message.
    expect(chat.messages[1].parts).toContainEqual({ type: 'steer', text: 'use A4 paper' })
    expect(chatService.get(chatId)!.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'make the report'],
      ['assistant', 'first reply'],
      ['user', 'then email it'],
      ['assistant', 'second reply']
    ])
    expect(chatService.queuedFor(chatId)).toEqual([])
  })
})

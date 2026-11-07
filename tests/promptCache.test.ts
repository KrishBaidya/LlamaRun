import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-prompt-'))

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

const { systemFor, refreshPrompt } = await import('../src/main/chats/service')
const { memoryStore } = await import('../src/main/memory/store')

afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('the system prompt', () => {
  // Gemini and OpenAI cache a request's unchanged start; a memory saved mid-chat used to change it and start the cache over.
  it("stays the same for a chat's later turns after a memory is saved, so the prompt cache keeps working", () => {
    const first = systemFor(undefined, true, false, false, 'chat-a')
    memoryStore.add('User drinks tea', 'model')
    expect(systemFor(undefined, true, false, false, 'chat-a')).toBe(first)
    // A new chat, or the same one after compaction, sees it.
    expect(systemFor(undefined, true, false, false, 'chat-b')).toContain('User drinks tea')
    refreshPrompt('chat-a')
    expect(systemFor(undefined, true, false, false, 'chat-a')).toContain('User drinks tea')
  })

  it('puts what changes from turn to turn last', () => {
    const plain = systemFor(undefined, true, false, false, 'chat-c')!
    const withTurn = systemFor('Replies are read aloud.', true, true, true, 'chat-c')!
    expect(withTurn.startsWith(plain)).toBe(true)
    expect(withTurn.endsWith('Replies are read aloud.')).toBe(true)
    expect(withTurn).toContain('To install a skill the user links to')
  })
})

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '../src/shared/types'

const root = mkdtempSync(join(tmpdir(), 'llamarun-review-'))
process.env.LLAMARUN_SKILLS_DIR = join(root, 'skills')
process.env.LLAMARUN_CLAUDE_SKILLS_DIR = join(root, 'claude-skills')

vi.mock('electron', () => ({
  app: { getPath: () => join(root, 'userData'), isPackaged: false, getAppPath: () => process.cwd(), getVersion: () => '0' },
  globalShortcut: { register: () => true, unregister: () => {} },
  BrowserWindow: class {},
  dialog: {},
  Notification: class {},
  safeStorage: {},
  screen: {},
  shell: {},
  utilityProcess: {},
  nativeImage: {},
  session: {}
}))

// The chat model does a long task; the reviewer (a second generate call) answers with JSON.
const model = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], review: '' }))
vi.mock('../src/main/llm', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/llm')>()
  return {
    ...real,
    modelCatalog: async () => ({ groups: [], ollamaRunning: false }),
    generate: async (_input: unknown, opts: Record<string, unknown>) => {
      model.calls.push(opts)
      if (opts.system && String(opts.system).includes('You review a finished task')) return model.review
      const onTool = opts.onTool as (c: { id: string; name: string; server: string; args: Record<string, unknown> }) => void
      const onToolResult = opts.onToolResult as (id: string, r: unknown) => void
      for (let i = 0; i < 7; i++) {
        onTool({ id: `c${i}`, name: 'read_file', server: 'Llama Run', args: { path: `f${i}.txt` } })
        onToolResult(`c${i}`, { content: [{ type: 'text', text: 'ok' }] })
      }
      return 'Made the report.'
    }
  }
})

const { parseSuggestions } = await import('../src/main/chats/review')
const { chatService } = await import('../src/main/chats/service')
const { pluginHost } = await import('../src/main/plugins/host')
const { skillStore } = await import('../src/main/skills/store')
const { memoryStore } = await import('../src/main/memory/store')

afterEach(() => vi.restoreAllMocks())
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('the review after a long task (like Hermes)', () => {
  it('reads the reviewer JSON, dropping anything malformed', () => {
    expect(parseSuggestions('```json\n{"skill": {"name": "report", "description": "Make the weekly report.", "body": "1. Read."}, "memories": [{"text": "User is called Krish", "kind": "user"}, {"text": ""}]}\n```')).toEqual({
      skill: { name: 'report', description: 'Make the weekly report.', body: '1. Read.' },
      memories: [{ text: 'User is called Krish', kind: 'user' }]
    })
    expect(parseSuggestions('{"skill": null, "memories": []}')).toBeNull()
    expect(parseSuggestions('not json')).toBeNull()
  })

  it('proposes a skill and memories under a long reply, and keeps only what the user accepts', async () => {
    vi.spyOn(pluginHost, 'beforeTextGeneration').mockResolvedValue({ cancel: false, input_text: 'make the report', model: '' } as never)
    vi.spyOn(pluginHost, 'afterTextGeneration').mockImplementation(async (_i, response) => ({ response_text: response }) as never)
    model.review = JSON.stringify({
      skill: { name: 'weekly-report', description: 'Build the weekly report from the f*.txt files.', body: '## Steps\n1. Read each file.' },
      memories: [{ text: 'User wants reports as PDF', kind: 'user' }]
    })
    const events: ChatEvent[] = []
    const listener = (e: ChatEvent): void => void events.push(e)
    chatService.on('event', listener)
    const { chatId, done } = chatService.ask(null, 'make the report', { model: 'm' })
    const reply = await done
    await vi.waitFor(() => expect(events.some((e) => e.type === 'update' && e.message.suggestions)).toBe(true))
    chatService.off('event', listener)

    const reviewCall = model.calls.find((c) => String(c.system).includes('You review a finished task'))!
    expect(reviewCall.tools).toBeUndefined()
    chatService.keepSuggestion(chatId, reply.id, 0)
    expect(memoryStore.list().some((m) => m.text === 'User wants reports as PDF')).toBe(true)
    chatService.keepSuggestion(chatId, reply.id, 'dismiss')
    expect(skillStore.list().some((s) => s.id === 'weekly-report')).toBe(false)
  })
})

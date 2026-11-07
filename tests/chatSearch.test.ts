import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../src/shared/types'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-search-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => process.cwd(), getVersion: () => '0' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  nativeImage: {},
  session: {}
}))

const { chatStore } = await import('../src/main/chats/store')
const { searchChats, readChat } = await import('../src/main/chats/search')
const { callBuiltinTool } = await import('../src/main/assistant/builtins')
const { toolResultToText } = await import('../src/main/llm/toolPayload')

let n = 0
const msg = (role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${++n}`,
  role,
  content,
  status: 'done',
  createdAt: n,
  ...extra
})

function saved(title: string, messages: ChatMessage[], updatedAt: number): string {
  const chat = chatStore.create('model')
  chat.title = title
  chat.messages.push(...messages)
  chatStore.save(chat)
  chat.updatedAt = updatedAt
  return chat.id
}

const pdf = saved(
  'Create a new PDF, change the code',
  [
    msg('user', 'Create a new PDF, change the code and add my name, my UID is 12ABC34567.'),
    msg('assistant', 'Saved DBMS_Experiment_03.pdf in Downloads.', {
      parts: [{ type: 'tool', id: 't', name: 'render_html', server: 'Llama Run', status: 'done' }, { type: 'text', text: 'Saved it.' }]
    })
  ],
  2000
)
const coursera = saved('Coursera assignment', [msg('user', 'Complete my Coursera graded assignment'), msg('assistant', 'Opened the assignment page.')], 3000)

afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('searching earlier chats (like Hermes session_search)', () => {
  it('finds the chat with the most matching words, one hit per chat, with a snippet', () => {
    const hits = searchChats('DBMS PDF UID')
    expect(hits[0]).toMatchObject({ chatId: pdf, title: 'Create a new PDF, change the code' })
    expect(hits[0].snippet).toMatch(/UID|DBMS/)
    expect(hits.filter((h) => h.chatId === pdf)).toHaveLength(1)
    expect(searchChats('coursera')[0].chatId).toBe(coursera)
  })

  it('searches the tools a reply used, and leaves out the current chat', () => {
    expect(searchChats('render_html')[0].chatId).toBe(pdf)
    expect(searchChats('render_html', { exclude: pdf })).toEqual([])
    expect(searchChats('a')).toEqual([])
  })

  it('reads a window of a found chat', () => {
    const text = readChat(pdf, 2)
    expect(text).toContain('messages 1-2 of 2')
    expect(text).toContain('[1. user] Create a new PDF')
    expect(text).toContain('(tools: render_html)')
    expect(() => readChat('nope')).toThrow('No saved chat')
  })

  it('works as tools the model calls', async () => {
    const found = toolResultToText(await callBuiltinTool('chat_search', { query: 'Coursera assignment' }, { chatId: 'other' }))
    expect(found).toContain(`chat ${coursera}`)
    expect(toolResultToText(await callBuiltinTool('chat_read', { chat: coursera }))).toContain('Opened the assignment page.')
  })
})

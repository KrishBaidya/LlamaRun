import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../src/shared/types'

vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  Notification: class {},
  safeStorage: {},
  shell: {}
}))

const { historyFor } = await import('../src/main/chats/service')
const { titleFrom } = await import('../src/main/chats/store')

const msg = (role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: Math.random().toString(36),
  role,
  content,
  status: 'done',
  createdAt: 0,
  ...extra
})

describe('historyFor', () => {
  it('sends plugin-rewritten prompts and skips failed or cancelled replies', () => {
    const history = historyFor([
      msg('user', '/summarize x', { prompt: 'Summarize: x' }),
      msg('assistant', 'summary'),
      msg('user', '/skip'),
      msg('assistant', '', { status: 'cancelled', note: 'Cancelled by Prompt Logger' }),
      msg('user', 'next'),
      msg('assistant', 'partial', { status: 'error', error: 'boom' }),
      msg('user', 'again')
    ])
    expect(history).toEqual([
      { role: 'user', content: 'Summarize: x' },
      { role: 'assistant', content: 'summary' },
      { role: 'user', content: '/skip' },
      { role: 'user', content: 'next' },
      { role: 'user', content: 'again' }
    ])
  })
})

describe('titleFrom', () => {
  it('uses the first line, collapsed and truncated', () => {
    expect(titleFrom('  hello   world \nsecond line')).toBe('hello world')
    expect(titleFrom('x'.repeat(80))).toHaveLength(60)
    expect(titleFrom('   ')).toBe('New chat')
  })
})

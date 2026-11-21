import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../src/shared/types'
import { editMessage, switchVersion } from '../src/main/chats/branches'

const msg = (id: string, role: 'user' | 'assistant', content: string): ChatMessage => ({ id, role, content, status: 'done', createdAt: 1 })
const chat = [msg('u1', 'user', 'hi'), msg('a1', 'assistant', 'hello'), msg('u2', 'user', 'make a PDF'), msg('a2', 'assistant', 'done: a.pdf'), msg('u3', 'user', 'thanks'), msg('a3', 'assistant', 'np')]

describe('editing a message forks the chat', () => {
  it('ends the chat at the edited message and keeps the old branch as version 1', () => {
    const { messages, dropped } = editMessage(chat, 'u2', 'make a Word file')
    expect(messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2'])
    expect(dropped.map((m) => m.id)).toEqual(['a2', 'u3', 'a3'])
    const edited = messages[2]
    expect(edited.content).toBe('make a Word file')
    expect(edited.versions?.map((v) => v.content)).toEqual(['make a PDF', 'make a Word file'])
    expect(edited.versions?.[0].tail.map((m) => m.id)).toEqual(['a2', 'u3', 'a3'])
    expect(edited.version).toBe(1)
  })

  it('switches between branches, keeping what each one has gained since', () => {
    const forked = editMessage(chat, 'u2', 'make a Word file').messages
    const replied = [...forked, msg('b2', 'assistant', 'done: a.docx')]
    const back = switchVersion(replied, 'u2', 0)
    expect(back.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3'])
    expect(back[2].content).toBe('make a PDF')
    const again = switchVersion(back, 'u2', 1)
    expect(again.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'b2'])
    expect(again[2].content).toBe('make a Word file')
  })

  it('edits a version again as a third branch', () => {
    const first = editMessage(chat, 'u2', 'v2').messages
    const second = editMessage(first, 'u2', 'v3').messages
    expect(second[2].versions?.map((v) => v.content)).toEqual(['make a PDF', 'v2', 'v3'])
    expect(second[2].version).toBe(2)
  })

  it("refuses the model's messages and unknown ids", () => {
    expect(() => editMessage(chat, 'a1', 'x')).toThrow('Only your own')
    expect(() => editMessage(chat, 'nope', 'x')).toThrow('no longer')
    expect(() => switchVersion(chat, 'u2', 3)).toThrow('No such version')
  })
})

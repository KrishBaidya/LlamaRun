import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-attachments-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' }
}))

const { readDocument, documentBlock } = await import('../src/main/attachments/read')
const { chatStore } = await import('../src/main/chats/store')

afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('attached documents', () => {
  // Seen in a chat: asked to edit an attached PDF, the model had only its text and rebuilt it without the original's header and images.
  it('keep the file, so the model can work on the original and not only its text', async () => {
    const bytes = new TextEncoder().encode('SELECT 1;')
    const doc = await readDocument('query.sql', 'text/plain', bytes)
    expect(doc.path).toBe(join(userData, 'Attachments', doc.id, 'query.sql'))
    expect(readFileSync(doc.path!, 'utf8')).toBe('SELECT 1;')
    expect(documentBlock(doc)).toContain(`<document name="query.sql" path="${doc.path}">`)
  })

  it('are deleted with their chat', async () => {
    const doc = await readDocument('notes.txt', 'text/plain', new TextEncoder().encode('hi'))
    const chat = chatStore.create('model')
    chat.messages.push({ id: 'm', role: 'user', content: 'Read this', status: 'done', createdAt: 0, attachments: [doc] })
    chatStore.save(chat)
    chatStore.delete(chat.id)
    expect(existsSync(doc.path!)).toBe(false)
  })
})

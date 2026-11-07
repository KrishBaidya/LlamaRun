import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest } from '../src/shared/types'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-task-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => process.cwd(), getVersion: () => '0' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  nativeImage: {},
  session: {}
}))

const { builtinTools, callBuiltinTool } = await import('../src/main/assistant/builtins')
const { approvals } = await import('../src/main/assistant/approval')
const { toolResultToText } = await import('../src/main/llm/toolPayload')
const text = (r: Parameters<typeof toolResultToText>[0]): string => toolResultToText(r)

/** Shows each question card to `respond`, the way the chat window would. */
function onQuestion(respond: (request: ApprovalRequest) => void): void {
  approvals.removeAllListeners('changed')
  approvals.on('changed', (_chat, request) => request && queueMicrotask(() => respond(request)))
}

afterEach(() => approvals.removeAllListeners('changed'))
afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('working with the user on a task', () => {
  it('offers a to-do list and questions in typed turns', () => {
    expect(builtinTools({ shell: true }).map((t) => t.name)).toEqual(expect.arrayContaining(['todo_update', 'ask_user']))
    expect(builtinTools({}).map((t) => t.name)).not.toContain('ask_user')
  })

  it('confirms a to-do update in one line (the chat draws the list from the call)', async () => {
    const items = [
      { text: 'Read the PDF', status: 'done' },
      { text: 'Write the page', status: 'in_progress' },
      { text: 'Render it', status: 'pending' }
    ]
    expect(text(await callBuiltinTool('todo_update', { items }, { chatId: 'c1' }))).toBe('To-do list updated: 1 of 3 done.')
  })

  // Hermes' clarify and OpenCode's question: a choice only the user can make, with buttons.
  it('asks the user with options and returns what they picked or typed', async () => {
    let shown: ApprovalRequest | undefined
    onQuestion((request) => {
      shown = request
      approvals.reply(request.id, 'A4')
    })
    const picked = await callBuiltinTool('ask_user', { question: 'Which paper size?', options: ['A4', 'Letter'] }, { chatId: 'c1' })
    expect(text(picked)).toBe('The user answered: A4')
    expect(shown).toMatchObject({ kind: 'question', title: 'Which paper size?', options: ['A4', 'Letter'], other: true })

    onQuestion((request) => approvals.reply(request.id, 'Legal, please'))
    expect(text(await callBuiltinTool('ask_user', { question: 'Size?', options: ['A4'] }, { chatId: 'c1' }))).toBe('The user answered: Legal, please')
  })

  it('says so when the user skips the question or stops the reply', async () => {
    onQuestion((request) => approvals.answer(request.id, 'deny'))
    expect(text(await callBuiltinTool('ask_user', { question: 'Size?', options: ['A4'] }, { chatId: 'c1' }))).toContain('dismissed')
    onQuestion(() => approvals.cancelChat('c2'))
    expect(text(await callBuiltinTool('ask_user', { question: 'Size?', options: ['A4'] }, { chatId: 'c2' }))).toContain('dismissed')
  })
})

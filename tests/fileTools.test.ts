import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalAnswer, ApprovalRequest } from '../src/shared/types'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-files-'))
const elsewhere = mkdtempSync(join(tmpdir(), 'llamarun-user-'))

/** Just enough of Electron's nativeImage: the bytes stand for a 3000×1500 picture. */
const fakeImage = (width: number, height: number): Record<string, unknown> => ({
  isEmpty: () => false,
  getSize: () => ({ width, height }),
  resize: ({ width: w, height: h }: { width: number; height: number }) => fakeImage(w, h),
  toPNG: () => Buffer.from(`png ${width}x${height}`),
  toJPEG: () => Buffer.from(`jpeg ${width}x${height}`)
})

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  nativeImage: { createFromBuffer: () => fakeImage(3000, 1500) }
}))

const { builtinTools, callBuiltinTool } = await import('../src/main/assistant/builtins')
const { approvals } = await import('../src/main/assistant/approval')

const { toolResultToText } = await import('../src/main/llm/toolPayload')
const text = (r: Parameters<typeof toolResultToText>[0]): string => toolResultToText(r)

/** Answers the next approval card with `answer`, and records what was asked. */
function answerWith(answer: ApprovalAnswer): ApprovalRequest[] {
  const asked: ApprovalRequest[] = []
  approvals.removeAllListeners('changed')
  approvals.on('changed', (_chat, request) => {
    if (!request) return
    asked.push(request)
    queueMicrotask(() => approvals.answer(request.id, answer))
  })
  return asked
}

afterEach(() => approvals.removeAllListeners('changed'))
afterAll(() => {
  rmSync(userData, { recursive: true, force: true })
  rmSync(elsewhere, { recursive: true, force: true })
})

describe('file tools', () => {
  it('are offered with the shell tools, in typed turns only', () => {
    expect(builtinTools({ shell: true }).map((t) => t.name)).toEqual(expect.arrayContaining(['read_file', 'write_file']))
    expect(builtinTools({}).map((t) => t.name)).not.toContain('write_file')
  })

  // Seen in a chat: five of seventeen commands failed only on getting a script into a file through PowerShell quoting.
  it('write and read files in the skill workspace without asking', async () => {
    const asked = answerWith('deny')
    const script = 'print("Rs. \\u20b9 480")\nprint(\'done\')\n'
    const wrote = await callBuiltinTool('write_file', { path: 'scripts/make_pdf.py', content: script }, { chatId: 'c1' })
    expect(wrote.isError).toBe(false)
    expect(readFileSync(join(userData, 'SkillWorkspace', 'scripts', 'make_pdf.py'), 'utf8')).toBe(script)
    const read = await callBuiltinTool('read_file', { path: 'scripts/make_pdf.py' }, { chatId: 'c1' })
    expect(text(read)).toContain("print('done')")
    expect(asked).toEqual([])
  })

  it("read the chat's attachments without asking", async () => {
    const asked = answerWith('deny')
    const folder = join(userData, 'Attachments', 'a1')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'notes.txt'), 'attached text')
    expect(text(await callBuiltinTool('read_file', { path: join(folder, 'notes.txt') }, { chatId: 'c1' }))).toContain('attached text')
    expect(asked).toEqual([])
  })

  it("ask before touching the user's other files, and remember a folder they allow for the chat", async () => {
    const target = join(elsewhere, 'report.txt')
    let asked = answerWith('deny')
    const denied = await callBuiltinTool('write_file', { path: target, content: 'x' }, { chatId: 'c2' })
    expect(denied.isError).toBe(true)
    expect(asked[0]).toMatchObject({ title: 'Let the model write this file?', command: target })
    expect(existsSync(target)).toBe(false)

    asked = answerWith('always')
    expect((await callBuiltinTool('write_file', { path: target, content: 'v1' }, { chatId: 'c2' })).isError).toBe(false)
    await callBuiltinTool('write_file', { path: join(elsewhere, 'other.txt'), content: 'v2' }, { chatId: 'c2' })
    expect(text(await callBuiltinTool('read_file', { path: target }, { chatId: 'c2' }))).toContain('v1')
    expect(asked).toHaveLength(1)
    // Another chat is asked again.
    asked = answerWith('once')
    await callBuiltinTool('read_file', { path: target }, { chatId: 'c3' })
    expect(asked).toHaveLength(1)
  })

  it('show images to the model, scaled down to a readable size', async () => {
    answerWith('deny')
    writeFileSync(join(userData, 'SkillWorkspace', 'page1.png'), 'not really a png')
    const r = await callBuiltinTool('read_file', { path: 'page1.png' }, { chatId: 'c1' })
    expect(text(r)).toContain('image, 3000×1500 px (shown at 1568×784)')
    expect(r.content[1]).toEqual({ type: 'image', data: Buffer.from('png 1568x784').toString('base64'), mimeType: 'image/png' })
  })

  it('say plainly when a file is missing', async () => {
    const r = await callBuiltinTool('read_file', { path: 'nope.txt' }, { chatId: 'c1' })
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('does not exist')
  })
})

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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

/** What the fake render window loaded, and the windows still open. */
const rendered: { file: string; html: string }[] = []
let openWindows = 0

vi.mock('electron', async () => {
  const { readFileSync } = await import('node:fs')
  class FakeWindow {
    static getFocusedWindow = (): null => null
    static getAllWindows = (): unknown[] => []
    webContents = {
      id: 7,
      setWindowOpenHandler: () => undefined,
      on: () => undefined,
      executeJavaScript: async (code: string) => (code.includes('scrollHeight') ? 2000 : true),
      printToPDF: async () => Buffer.from('%PDF-1.4 /Type /Pages /Type /Page /Type /Page'),
      capturePage: async () => fakeImage(1200, 2000)
    }
    constructor() {
      openWindows++
    }
    async loadFile(file: string): Promise<void> {
      rendered.push({ file, html: readFileSync(file, 'utf8') })
    }
    setContentSize(): void {}
    destroy(): void {
      openWindows--
    }
  }
  return {
    app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
    BrowserWindow: FakeWindow,
    dialog: {},
    nativeImage: { createFromBuffer: () => fakeImage(3000, 1500) },
    session: { fromPartition: () => ({ webRequest: { onBeforeRequest: () => undefined }, setPermissionRequestHandler: () => undefined }) }
  }
})

const { builtinTools, callBuiltinTool } = await import('../src/main/assistant/builtins')
const { allowedRequest } = await import('../src/main/assistant/render')
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

  // Claude makes PDFs by printing HTML with Chromium; Llama Run ships Chromium, so one call does it.
  it('print HTML to a PDF with the built-in Chromium, in one call', async () => {
    answerWith('deny')
    const r = await callBuiltinTool('render_html', { html: '<h1>Total: &#8377;480</h1>', output: 'out/report.pdf' }, { chatId: 'c1' })
    expect(text(r)).toContain('Saved a 2-page PDF to')
    expect(readFileSync(join(userData, 'SkillWorkspace', 'out', 'report.pdf'), 'latin1')).toContain('%PDF')
    // The markup loaded from a file in the workspace (so its relative links work), removed afterwards; the window is closed.
    expect(rendered.at(-1)!.html).toBe('<h1>Total: &#8377;480</h1>')
    expect(rendered.at(-1)!.file.startsWith(join(userData, 'SkillWorkspace'))).toBe(true)
    expect(existsSync(rendered.at(-1)!.file)).toBe(false)
    expect(openWindows).toBe(0)
  })

  it('capture HTML as a PNG and show it to the model', async () => {
    const r = await callBuiltinTool('render_html', { html: '<p>poster</p>', output: 'poster.png' }, { chatId: 'c1' })
    expect(text(r)).toContain('poster.png, 1200×2000 px (shown at 941×1568)')
    expect(r.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' })
    expect(existsSync(join(userData, 'SkillWorkspace', 'poster.png'))).toBe(true)
  })

  it('refuse outputs that are not .pdf or .png, and need html or a file', async () => {
    expect(text(await callBuiltinTool('render_html', { html: '<p>x</p>', output: 'a.docx' }, { chatId: 'c1' }))).toContain('.pdf or .png')
    expect(text(await callBuiltinTool('render_html', { output: 'a.pdf' }, { chatId: 'c1' }))).toContain('Give html or file')
  })

  it("let a rendered page load only local files from the allowed folders, and only GET the web", () => {
    const folders = [join(userData, 'SkillWorkspace')]
    const local = (p: string): string => pathToFileURL(p).href
    expect(allowedRequest(local(join(userData, 'SkillWorkspace', 'logo.png')), 'GET', folders)).toBe(true)
    expect(allowedRequest(local(join(elsewhere, 'secret.txt')), 'GET', folders)).toBe(false)
    expect(allowedRequest('https://fonts.googleapis.com/css2?family=Inter', 'GET', folders)).toBe(true)
    expect(allowedRequest('https://example.com/collect', 'POST', folders)).toBe(false)
    expect(allowedRequest('data:image/png;base64,AAAA', 'GET', folders)).toBe(true)
  })

  // OpenCode's edit and Hermes' patch: change part of a file without sending all of it again.
  it('edit part of a file: one exact match, or every one with replace_all', async () => {
    answerWith('deny')
    const file = join(userData, 'SkillWorkspace', 'page.html')
    writeFileSync(file, '<h1>Old</h1>\n<p>a</p>\n<p>a</p>\n')
    const r = await callBuiltinTool('edit_file', { path: 'page.html', old_string: '<h1>Old</h1>', new_string: '<h1>New</h1>' }, { chatId: 'c1' })
    expect(readFileSync(file, 'utf8')).toBe('<h1>New</h1>\n<p>a</p>\n<p>a</p>\n')
    expect(text(r)).toContain('1| <h1>New</h1>')
    expect(text(await callBuiltinTool('edit_file', { path: 'page.html', old_string: '<p>a</p>', new_string: '<p>b</p>' }, { chatId: 'c1' }))).toContain('appears 2 times')
    await callBuiltinTool('edit_file', { path: 'page.html', old_string: '<p>a</p>', new_string: '<p>b</p>', replace_all: true }, { chatId: 'c1' })
    expect(readFileSync(file, 'utf8')).toBe('<h1>New</h1>\n<p>b</p>\n<p>b</p>\n')
    expect(text(await callBuiltinTool('edit_file', { path: 'page.html', old_string: 'nope', new_string: 'x' }, { chatId: 'c1' }))).toContain('is not in')
  })

  it('edit Windows files whose lines end in CRLF', async () => {
    const file = join(userData, 'SkillWorkspace', 'win.txt')
    writeFileSync(file, 'one\r\ntwo\r\nthree\r\n')
    await callBuiltinTool('edit_file', { path: 'win.txt', old_string: 'one\ntwo', new_string: 'uno\ndos' }, { chatId: 'c1' })
    expect(readFileSync(file, 'utf8')).toBe('uno\r\ndos\r\nthree\r\n')
  })

  it('read long files a page at a time, and answer a repeat in the same reply with one line', async () => {
    const file = join(userData, 'SkillWorkspace', 'long.txt')
    writeFileSync(file, Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join('\n'))
    const first = text(await callBuiltinTool('read_file', { path: 'long.txt' }, { chatId: 'c1', messageId: 'm1' }))
    // A page fits in what the model is shown of a result, and says where to go on.
    expect(first.length).toBeLessThan(16_000)
    expect(first).toMatch(/\(lines 1-\d+ of 2500\)/)
    let page = first
    let offset = 0
    for (let n = 0; n < 10 && /read on with offset (\d+)/.test(page); n++) {
      offset = Number(/read on with offset (\d+)/.exec(page)![1])
      page = text(await callBuiltinTool('read_file', { path: 'long.txt', offset }, { chatId: 'c1', messageId: 'm1' }))
    }
    expect(offset).toBeGreaterThan(1)
    expect(page).toContain('2500| line 2500')
    expect(text(await callBuiltinTool('read_file', { path: 'long.txt' }, { chatId: 'c1', messageId: 'm1' }))).toContain('unchanged since you read it earlier in this reply')
    // Another reply reads it in full again.
    expect(text(await callBuiltinTool('read_file', { path: 'long.txt' }, { chatId: 'c1', messageId: 'm2' }))).toContain('1| line 1')
  })

  // Seen in chats: a card for every python command. "Always allow python *" now covers the next ones.
  it('run commands under a saved rule without asking, and offer "Allow for this chat"', async () => {
    let asked = answerWith('always')
    expect(text(await callBuiltinTool('run_command', { command: 'echo first' }, { chatId: 'r1' }))).toContain('first')
    expect(asked[0]).toMatchObject({ alwaysLabel: 'Always allow echo *', chatLabel: 'Allow for this chat' })
    asked = answerWith('deny')
    expect(text(await callBuiltinTool('run_command', { command: 'echo second' }, { chatId: 'r2' }))).toContain('second')
    expect(asked).toEqual([])

    asked = answerWith('chat')
    await callBuiltinTool('run_command', { command: 'Write-Output one' }, { chatId: 'r3' })
    await callBuiltinTool('run_command', { command: 'Write-Output two' }, { chatId: 'r3' })
    expect(asked).toHaveLength(1)
    // Only for that chat.
    asked = answerWith('once')
    await callBuiltinTool('run_command', { command: 'Write-Output three' }, { chatId: 'r4' })
    expect(asked).toHaveLength(1)
  }, 30_000)

  it('say plainly when a file is missing', async () => {
    const r = await callBuiltinTool('read_file', { path: 'nope.txt' }, { chatId: 'c1' })
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('does not exist')
  })
})

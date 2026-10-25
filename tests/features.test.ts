import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ChatAttachment, ChatMessage, ModelInfo } from '../src/shared/types'

vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  globalShortcut: {},
  Notification: class {},
  safeStorage: {},
  shell: {}
}))

const { historyFor } = await import('../src/main/chats/service')
const { contextWindowFor, estimateTokens, FALLBACK_CONTEXT_TOKENS, OLLAMA_DEFAULT_MAX_CONTEXT } = await import('../src/main/chats/context')
const { splitForCompaction, transcriptOf, SUMMARY_INTRO } = await import('../src/main/chats/compact')
const { parseFrontMatter } = await import('../src/main/skills/frontMatter')
const { resolveSource } = await import('../src/main/skills/source')
const { MemoryStore } = await import('../src/main/memory/store')
const { htmlToText } = await import('../src/main/assistant/builtins')
const { contextLengthOf } = await import('../src/main/llm/ollama')
const { documentBlock } = await import('../src/main/attachments/read')

let n = 0
const msg = (role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${++n}`,
  role,
  content,
  status: 'done',
  createdAt: 0,
  ...extra
})

const model = (id: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({ id, name: id, provider: 'gemini', cloud: true, ...extra })
const prefs = { modelContext: {}, autoCompactPercent: 80 }

describe('contextWindowFor', () => {
  it('gives each model its own window, even from the same provider', () => {
    expect(contextWindowFor('flash', model('flash', { contextWindow: 1_048_576 }), prefs)).toMatchObject({ tokens: 1_048_576, source: 'model' })
    expect(contextWindowFor('mini', model('mini', { contextWindow: 128_000 }), prefs)).toMatchObject({ tokens: 128_000, source: 'model' })
  })

  it("uses the user's override for that model only, with its own compact threshold", () => {
    const p = { autoCompactPercent: 80, modelContext: { mini: { contextTokens: 64_000, compactAtPercent: 70 } } }
    expect(contextWindowFor('mini', model('mini', { contextWindow: 128_000 }), p)).toEqual({
      model: 'mini',
      tokens: 64_000,
      source: 'override',
      reported: 128_000,
      compactAtPercent: 70
    })
    expect(contextWindowFor('flash', model('flash', { contextWindow: 1_048_576 }), p).compactAtPercent).toBe(80)
  })

  it('caps big Ollama windows by default and falls back when a model reports nothing', () => {
    const local = model('qwen3:8b', { provider: 'ollama', cloud: false, contextWindow: 131_072 })
    expect(contextWindowFor(local.id, local, prefs)).toMatchObject({ tokens: OLLAMA_DEFAULT_MAX_CONTEXT, reported: 131_072 })
    expect(contextWindowFor('mystery', undefined, prefs)).toMatchObject({ tokens: FALLBACK_CONTEXT_TOKENS, source: 'fallback' })
  })

  it("reads an Ollama model's context_length from its model info", () => {
    expect(contextLengthOf({ 'general.architecture': 'qwen3', 'qwen3.context_length': 40960 })).toBe(40960)
    expect(contextLengthOf(new Map([['llama.context_length', 8192]]))).toBe(8192)
    expect(contextLengthOf(undefined)).toBeUndefined()
  })
})

describe('compaction', () => {
  const chat = [
    msg('user', 'I am planning a trip to Goa'),
    msg('assistant', 'Great! When?'),
    msg('user', 'In December, budget 40k'),
    msg('assistant', 'Noted.'),
    msg('user', 'Find hotels'),
    msg('assistant', 'Here are three hotels…')
  ]

  it('summarises everything before the last N user turns', () => {
    const split = splitForCompaction(chat, 2)!
    expect(split.older.map((m) => m.content)).toEqual(['I am planning a trip to Goa', 'Great! When?'])
    expect(split.kept[0].content).toBe('In December, budget 40k')
    expect(splitForCompaction(chat, 3)).toBeNull()
  })

  it('shows the model the summary and only what came after it', () => {
    const compaction = { summary: 'Trip to Goa.', throughMessageId: chat[1].id, createdAt: 0, tokensBefore: 0, tokensAfter: 0 }
    const history = historyFor(chat, compaction)
    expect(history[0]).toEqual({ role: 'user', content: `${SUMMARY_INTRO}\n\nTrip to Goa.` })
    expect(history[1].role).toBe('assistant')
    expect(history.slice(2).map((m) => m.content)).toEqual(['In December, budget 40k', 'Noted.', 'Find hotels', 'Here are three hotels…'])
    // A second compaction only covers messages after the first one.
    expect(splitForCompaction(chat, 1, compaction)!.older.map((m) => m.content)).toEqual(['In December, budget 40k', 'Noted.'])
  })

  it('keeps the newest part of a transcript that is too long, after the earlier summary', () => {
    const text = transcriptOf([msg('user', 'a'.repeat(50)), msg('assistant', 'the end')], 'Before.', 30)
    expect(text.startsWith('Earlier summary:\nBefore.')).toBe(true)
    expect(text).toContain('the end')
    expect(text).toContain('[…earlier part cut…]')
  })

  it('counts images and tools in the token estimate', () => {
    const plain = estimateTokens([{ role: 'user', content: 'x'.repeat(400) }])
    expect(plain).toBe(104)
    expect(estimateTokens([{ role: 'user', content: 'x'.repeat(400), images: [{ data: '', mediaType: 'image/png' }] }])).toBe(plain + 1000)
  })
})

describe('attachments in history', () => {
  it('adds documents as text and passes images separately', () => {
    const doc: ChatAttachment = { id: 'd', kind: 'document', name: 'notes.pdf', mimeType: 'application/pdf', size: 1, text: 'Hello', pages: 2 }
    const image: ChatAttachment = { id: 'i', kind: 'image', name: 'a.png', mimeType: 'image/png', size: 1, dataUrl: 'data:image/png;base64,QUJD' }
    const [turn] = historyFor([msg('user', 'Summarise', { attachments: [doc, image] })])
    expect(turn.content).toBe(`Summarise\n\n${documentBlock(doc)}`)
    expect(turn.content).toContain('<document name="notes.pdf" pages="2">')
    expect(turn.images).toEqual([{ data: 'QUJD', mediaType: 'image/png' }])
    // An image on its own still makes a valid turn.
    expect(historyFor([msg('user', '', { attachments: [image] })])[0].content).toBe('See the attached image.')
  })
})

describe('skills', () => {
  it('reads SKILL.md front matter, including folded descriptions', () => {
    const { data, body } = parseFrontMatter('---\nname: pdf\ndescription: >\n  Fill and merge\n  PDF forms.\nlicense: "MIT"\n---\n# PDF\nBody')
    expect(data).toEqual({ name: 'pdf', description: 'Fill and merge PDF forms.', license: 'MIT' })
    expect(body).toBe('# PDF\nBody')
    expect(parseFrontMatter('# No front matter').data).toEqual({})
  })

  it('understands the links and files Claude installs skills from', () => {
    expect(resolveSource('anthropics/skills')).toEqual({ kind: 'github', owner: 'anthropics', repo: 'skills', path: '' })
    expect(resolveSource('https://github.com/anthropics/skills/tree/main/skills/pdf')).toEqual({
      kind: 'github',
      owner: 'anthropics',
      repo: 'skills',
      ref: 'main',
      path: 'skills/pdf'
    })
    expect(resolveSource('https://github.com/o/r/blob/dev/x/SKILL.md')).toMatchObject({ kind: 'github', ref: 'dev', path: 'x' })
    expect(resolveSource('https://gitlab.com/group/proj/-/tree/main/skills/a')).toEqual({
      kind: 'git',
      url: 'https://gitlab.com/group/proj.git',
      ref: 'main',
      path: 'skills/a'
    })
    expect(resolveSource('https://example.com/me/tools.git')).toMatchObject({ kind: 'git', url: 'https://example.com/me/tools.git' })
    expect(resolveSource('https://example.com/skill.zip')).toEqual({ kind: 'zip-url', url: 'https://example.com/skill.zip' })
    expect(resolveSource('https://example.com/raw/SKILL.md')).toEqual({ kind: 'skill-md', url: 'https://example.com/raw/SKILL.md' })
    expect(resolveSource('C:\\skills\\x.zip', { isDir: () => false, isFile: () => true })).toEqual({ kind: 'zip-file', path: 'C:\\skills\\x.zip' })
    expect(resolveSource('C:\\skills\\x', { isDir: () => true, isFile: () => false })).toEqual({ kind: 'folder', path: 'C:\\skills\\x' })
    expect(() => resolveSource('https://example.com/page')).toThrow(/Install with AI/)
  })

  it('turns a page into readable text for web_fetch', () => {
    expect(htmlToText('<style>x{}</style><h1>Install</h1><p>Run <code>pip</code> &amp; go</p><script>bad()</script>')).toBe('Install\nRun pip & go')
  })
})

describe('memory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'llamarun-memory-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('adds, dedupes, updates and forgets facts, and persists them', () => {
    const file = join(dir, 'memory.json')
    const store = new MemoryStore(() => file)
    const a = store.add('Prefers  metric units', 'model')
    expect(a.text).toBe('Prefers metric units')
    expect(store.add('prefers metric units', 'user').id).toBe(a.id)
    store.update(a.id, 'Prefers imperial units', 'user')
    expect(new MemoryStore(() => file).list()).toMatchObject([{ id: a.id, text: 'Prefers imperial units', source: 'user' }])
    expect(store.remove(a.id)).toBe(true)
    expect(store.remove(a.id)).toBe(false)
    expect(() => store.add('   ', 'user')).toThrow()
    expect(() => store.add('x'.repeat(501), 'user')).toThrow()
  })
})

describe('shell tools', () => {
  it('are only offered for install requests or "Install with AI" chats', async () => {
    const { wantsShell } = await import('../src/main/chats/service')
    expect(wantsShell({}, 'Install the skill at https://github.com/anthropics/skills')).toBe(true)
    expect(wantsShell({}, 'please install skills from anthropics/skills')).toBe(true)
    expect(wantsShell({}, 'C:/Program Files/Git/compact focus on the PDF key points')).toBe(false)
    expect(wantsShell({}, 'How do I install Python?')).toBe(false)
    expect(wantsShell({ installer: true }, 'continue')).toBe(true)
  })
})

describe('skill packages', () => {
  it("names the pip package a script is missing", async () => {
    const { missingPackage } = await import('../src/main/skills/store')
    expect(missingPackage("Traceback…\nModuleNotFoundError: No module named 'pypdf'")).toBe('pypdf')
    expect(missingPackage("ModuleNotFoundError: No module named 'docx.shared'")).toBe('python-docx')
    expect(missingPackage('ValueError: nope')).toBeNull()
  })
})

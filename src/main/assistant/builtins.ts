import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { nativeImage, type NativeImage } from 'electron'
import type { CommandRule, McpToolInfo, MemoryKind } from '@shared/types'
import { analytics } from '../analytics'
import { documentText } from '../attachments/read'
import { formatHits, readChat, searchChats } from '../chats/search'
import { MAX_TOOL_RESULT_CHARS } from '../llm/toolPayload'
import { renderHtml } from './render'
import type { McpToolResult } from '../mcp/manager'
import { kindOf, MEMORY_BUDGET, memoryStore } from '../memory/store'
import { pythonExecutable, userDataPath } from '../paths'
import { settings } from '../settings'
import { cut, skillsDir, skillStore, skillWorkspace } from '../skills/store'
import { approvals, askApproval } from './approval'
import { recordChange } from './fileChanges'
import { decide, proposeRules } from './commandRules'

/**
 * Tools Llama Run itself gives the model, next to the MCP servers' and plugins':
 * memory (what it knows about the user), skills (SKILL.md folders it can load
 * and whose Python scripts it can run), and, like Claude Code, reading web
 * pages and running commands (each one approved): the general way to get a task
 * done that no tool covers, and how skills get installed from a README.
 */

const SERVER = 'Llama Run'
const COMMAND_TIMEOUT_MS = 10 * 60_000
const MAX_OUTPUT_CHARS = 16_000
const MAX_PAGE_CHARS = 40_000
/** Lines read_file returns at most per call. */
const READ_LINES = 2000
/** Characters of file read_file returns per call: under what the model is shown of a result, so "read on" survives. */
const READ_PAGE_CHARS = MAX_TOOL_RESULT_CHARS - 1000

const result = (text: string, isError = false): McpToolResult => ({ content: [{ type: 'text', text }], isError })

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`"${key}" is required`)
  return value
}

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): McpToolInfo => ({
  name,
  server: SERVER,
  description,
  inputSchema: { type: 'object', properties, required }
})

const MEMORY_TOOLS: McpToolInfo[] = [
  tool(
    'memory_save',
    'Remember something for later chats. kind "user": a lasting fact about the user (name, job, preferences, projects, people, how they like answers), starting with "User" or their name, e.g. "User prefers metric units"; use "they" or the name, never a guessed he/she. kind "note": something you learned that will help later (a fact about their setup, a convention, a fix that worked). One short entry per call, not details of the current task only. Space is limited; when it is full, merge or remove entries first.',
    {
      text: { type: 'string', description: 'The fact, e.g. "User prefers metric units".' },
      kind: { type: 'string', enum: ['user', 'note'], description: 'Default: user if it starts with "User", otherwise note.' }
    },
    ['text']
  ),
  tool(
    'memory_update',
    'Rewrite a saved memory that is out of date or wrong. Use its id from the memory list.',
    { id: { type: 'string' }, text: { type: 'string', description: 'The corrected fact.' } },
    ['id', 'text']
  ),
  tool(
    'memory_forget',
    'Delete a saved memory (the user asked you to forget it, or it is no longer true). Use its id from the memory list.',
    { id: { type: 'string' } },
    ['id']
  )
]

/** Writing skills, like Hermes' skill_manage: a procedure that worked is kept and improved instead of worked out again. */
const SKILL_WRITE_TOOLS: McpToolInfo[] = [
  tool(
    'skill_create',
    "Save a procedure as a skill, so later chats load it instead of working it out again. The description says when to use it (it decides when the skill is loaded); the body is the instructions in Markdown: the steps, pitfalls you hit, and how to check the result. Saved in the shared skills folder.",
    {
      name: { type: 'string', description: 'Short name, e.g. "lab-report-pdf".' },
      description: { type: 'string', description: 'One line: what it does and when to use it.' },
      body: { type: 'string', description: 'The instructions, in Markdown.' }
    },
    ['name', 'description', 'body']
  ),
  tool(
    'skill_edit',
    "Improve a skill Llama Run made: replace old_string in its SKILL.md with new_string (exact, once unless replace_all). Installed and Claude Code skills can't be changed.",
    {
      skill: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' }
    },
    ['skill', 'old_string', 'new_string']
  ),
  tool(
    'skill_write_file',
    'Add or replace a file in a skill Llama Run made, e.g. scripts/make_report.py or templates/report.html.',
    { skill: { type: 'string' }, path: { type: 'string', description: 'Relative to the skill folder.' }, content: { type: 'string' } },
    ['skill', 'path', 'content']
  )
]

const SKILL_TOOLS: McpToolInfo[] = [
  tool(
    'skill_load',
    "Load a skill's instructions (its SKILL.md) and file list. Do this before a task the skill covers.",
    { skill: { type: 'string', description: 'Skill name from the list.' } },
    ['skill']
  ),
  tool(
    'skill_read_file',
    'Read another file a skill ships (a reference doc, template or script), when its SKILL.md points to it.',
    { skill: { type: 'string' }, path: { type: 'string', description: 'Path relative to the skill folder.' } },
    ['skill', 'path']
  ),
  tool(
    'skill_run_script',
    "Run one of a skill's Python scripts and get its exit code, stdout and stderr. The user may be asked to allow it first.",
    {
      skill: { type: 'string' },
      script: { type: 'string', description: 'Script path relative to the skill folder, e.g. "scripts/fill_form.py".' },
      args: { type: 'array', items: { type: 'string' }, description: 'Command-line arguments.' },
      stdin: { type: 'string', description: 'Text piped to the script, if it reads stdin.' }
    },
    ['skill', 'script']
  )
]

const SHELL_TOOLS: McpToolInfo[] = [
  tool(
    'web_fetch',
    'Read a web page or file as text, e.g. a README. GitHub repository links return the README.',
    { url: { type: 'string' } },
    ['url']
  ),
  tool(
    'run_command',
    `Run a ${process.platform === 'win32' ? 'PowerShell' : 'shell'} command on the user's computer (run a script you wrote, convert a file, pip install, git clone…) and get its output. The user approves each command. Runs in the skill workspace folder (where skill scripts write files) unless cwd is given. "python" and "pip" are Llama Run's bundled Python.`,
    { command: { type: 'string' }, cwd: { type: 'string', description: 'Working folder (absolute).' } },
    ['command']
  )
]

const FILE_TOOLS: McpToolInfo[] = [
  tool(
    'read_file',
    'Read a file: text and code with numbered lines ("12| …"; the numbers are not part of the file), PDF and Word files as text, images (PNG, JPEG, GIF, WebP, BMP) as the image itself for models that can see. Long files come in pages: pass offset to read on. Relative paths are in the skill workspace folder.',
    {
      path: { type: 'string', description: 'Absolute, or relative to the skill workspace folder.' },
      offset: { type: 'integer', description: 'First line to read (1-based). Default 1.' },
      limit: { type: 'integer', description: `Most lines to read. Default ${READ_LINES}.` }
    },
    ['path']
  ),
  tool(
    'write_file',
    'Write a text file (a script, data, a page…), creating its folder; an existing file is replaced. To change part of a file, use edit_file. Relative paths are in the skill workspace folder.',
    { path: { type: 'string', description: 'Absolute, or relative to the skill workspace folder.' }, content: { type: 'string' } },
    ['path', 'content']
  ),
  tool(
    'edit_file',
    'Change part of a text file: replace old_string, which must appear exactly once (or set replace_all), with new_string. Returns the changed lines.',
    {
      path: { type: 'string', description: 'Absolute, or relative to the skill workspace folder.' },
      old_string: { type: 'string', description: "The exact text to replace, as it is in the file (without read_file's line numbers)." },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence. Default false.' }
    },
    ['path', 'old_string', 'new_string']
  ),
  tool(
    'render_html',
    "Render HTML with Llama Run's built-in Chromium and save it as a PDF (printed like a browser prints; CSS @page sets size and margins, A4 by default) or a PNG of the whole page (returned as an image to models that can see). Give the markup itself or an HTML file. Relative URLs load from the skill workspace folder (or the HTML file's folder); local files load from there and from the chat's attachments.",
    {
      html: { type: 'string', description: 'The markup. Or give file.' },
      file: { type: 'string', description: 'An HTML file to render instead of html.' },
      output: { type: 'string', description: 'Where to save: a .pdf or .png path, absolute or relative to the skill workspace folder.' },
      width: { type: 'integer', description: 'PNG only: page width in pixels (default 1200).' }
    },
    ['output']
  )
]

/** Working with the user on a longer task: a visible plan (Hermes' todo, OpenCode's todowrite) and questions with choices. */
const TASK_TOOLS: McpToolInfo[] = [
  tool(
    'todo_update',
    'Show the user a to-do list for a task with several steps, and keep it current: send the whole list each time, each item with its status.',
    {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } },
          required: ['text', 'status']
        }
      }
    },
    ['items']
  ),
  tool(
    'ask_user',
    'Ask the user a question and wait for the answer: they pick one of the options (or type their own when other is true). For a choice only they can make.',
    {
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' }, description: '2 to 6 short choices.' },
      other: { type: 'boolean', description: 'Let them type an answer of their own. Default true.' }
    },
    ['question', 'options']
  )
]

/** Past chats, like Hermes' session_search: how a task went before, without asking the user again. */
const CHAT_TOOLS: McpToolInfo[] = [
  tool(
    'chat_search',
    "Search the user's earlier chats in Llama Run for words or a phrase: what was asked, said and done before. Returns the best-matching message of each chat.",
    { query: { type: 'string' }, limit: { type: 'integer', description: 'Most chats to return (default 8).' } },
    ['query']
  ),
  tool(
    'chat_read',
    'Read messages of an earlier chat found with chat_search, around a message number.',
    { chat: { type: 'string', description: 'The chat id from chat_search.' }, around: { type: 'integer', description: 'Message number to center on.' } },
    ['chat']
  )
]

const INSTALL_TOOLS: McpToolInfo[] = [
  tool('skills_refresh', 'Rescan the Skills folder after installing or changing a skill, and list what is installed.', {}, [])
]

const memoryOn = (): boolean => settings.get('memoryEnabled') !== false
const skillsOn = (): boolean => settings.get('skillsEnabled') !== false

export interface BuiltinOptions {
  /** Offer run_command, web_fetch, read_file and write_file (typed turns only, never plugin-sent ones). */
  shell?: boolean
  /** The user asked to install a skill: say where skills go. */
  install?: boolean
}

export function builtinTools(options: BuiltinOptions = {}): McpToolInfo[] {
  return [
    ...(memoryOn() ? MEMORY_TOOLS : []),
    ...(skillsOn() && skillStore.active().length ? SKILL_TOOLS : []),
    ...(skillsOn() && options.shell ? SKILL_WRITE_TOOLS : []),
    ...(options.shell ? [...SHELL_TOOLS, ...FILE_TOOLS, ...CHAT_TOOLS, ...TASK_TOOLS] : []),
    ...(skillsOn() && options.shell ? INSTALL_TOOLS : [])
  ]
}

const NAMES = new Set([...MEMORY_TOOLS, ...SKILL_TOOLS, ...SKILL_WRITE_TOOLS, ...SHELL_TOOLS, ...FILE_TOOLS, ...CHAT_TOOLS, ...TASK_TOOLS, ...INSTALL_TOOLS].map((t) => t.name))

export function isBuiltinTool(name: string): boolean {
  return NAMES.has(name)
}

/** Page text without markup, scripts or styles. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

async function webFetch(target: string): Promise<string> {
  const url = new URL(/^https?:\/\//.test(target) ? target : `https://${target}`)
  const repo = url.hostname === 'github.com' ? url.pathname.split('/').filter(Boolean) : []
  // A repository (or folder) page: its README, as Markdown.
  if (repo.length === 2 || (repo.length > 3 && repo[2] === 'tree')) {
    const [owner, name, , ref, ...path] = repo
    const api = `https://api.github.com/repos/${owner}/${name}/readme${path.length ? `/${path.join('/')}` : ''}${ref ? `?ref=${ref}` : ''}`
    const res = await fetch(api, { headers: { Accept: 'application/vnd.github.raw', 'User-Agent': 'LlamaRun' } })
    if (res.ok) return cut(`README of ${url.href}:\n\n${await res.text()}`, MAX_PAGE_CHARS)
  }
  if (url.hostname === 'github.com' && repo[2] === 'blob') {
    url.hostname = 'raw.githubusercontent.com'
    url.pathname = `/${[...repo.slice(0, 2), ...repo.slice(3)].join('/')}`
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'LlamaRun' }, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.href}`)
  const type = res.headers.get('content-type') ?? ''
  const body = await res.text()
  return cut(type.includes('html') ? htmlToText(body) : body, MAX_PAGE_CHARS)
}

/** Largest file read_file takes. */
const MAX_FILE_BYTES = 25 * 1024 * 1024
/** Long edge of images read_file shows the model: enough to read text, small enough to keep requests cheap. */
const IMAGE_EDGE = 1568
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }
/** Folders the user let the model read or write in, per chat ("Allow this folder"). */
const allowedFolders = new Map<string, Set<string>>()

const inside = (path: string, folder: string): boolean => {
  const rel = relative(folder, path)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Files in the skill workspace (where scripts and their output go) and, for
 * reading, the chat's attachments are the model's own; anything else is the
 * user's, and they approve it once per folder for the chat.
 */
async function approveFile(path: string, write: boolean, chatId: string | undefined): Promise<void> {
  const own = write ? [skillWorkspace()] : [skillWorkspace(), userDataPath('Attachments')]
  if (own.some((folder) => inside(path, folder))) return
  const allowed = chatId ? allowedFolders.get(chatId) : undefined
  if (allowed && [...allowed].some((folder) => inside(path, folder))) return
  const answer = await askApproval(chatId, {
    title: write ? 'Let the model write this file?' : 'Let the model read this file?',
    command: path,
    detail: write ? (existsSync(path) ? 'It replaces the file that is there.' : 'A new file.') : 'What it contains goes to the model.',
    alwaysLabel: 'Allow this folder'
  })
  if (answer === 'deny') throw new Error(`The user didn't allow ${write ? 'writing' : 'reading'} ${path}. Ask them how to continue.`)
  if (answer === 'always' && chatId) allowedFolders.set(chatId, new Set([...(allowed ?? []), dirname(path)]))
}

/** Reads already returned in a reply (path, range -> the file's state then), so an unchanged repeat costs a line, not the file again. */
const recentReads = new Map<string, Map<string, string>>()

async function readFile(pathArg: string, context: ToolContext, offsetArg?: unknown, limitArg?: unknown): Promise<McpToolResult> {
  const path = resolve(skillWorkspace(), pathArg.trim())
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${path} does not exist`)
  const stat = statSync(path)
  if (stat.size > MAX_FILE_BYTES) throw new Error(`${path} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`)
  await approveFile(path, false, context.chatId)
  const offset = Math.max(1, Math.floor(Number(offsetArg) || 1))
  const limit = Math.max(1, Math.min(READ_LINES, Math.floor(Number(limitArg) || READ_LINES)))
  const key = `${path}\u0000${offset}\u0000${limit}`
  const state = `${stat.mtimeMs}:${stat.size}`
  let reads = context.messageId ? recentReads.get(context.messageId) : undefined
  if (context.messageId && !reads) {
    recentReads.set(context.messageId, (reads = new Map()))
    // Only replies still running need theirs.
    if (recentReads.size > 20) recentReads.delete(recentReads.keys().next().value!)
  }
  if (reads?.get(key) === state) return result(`${path} is unchanged since you read it earlier in this reply.`)
  reads?.set(key, state)
  const bytes = readFileSync(path)
  const type = IMAGE_TYPES[extname(path).toLowerCase()]
  if (type) {
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) throw new Error(`${path} is not an image Llama Run can open`)
    return imageResult(`${path}: image`, image, type === 'image/jpeg')
  }
  const { text, pages } = await documentText(path, '', bytes)
  return result(numbered(pages ? `${path} (${pages} pages)` : path, text, offset, limit))
}

/**
 * Lines offset..offset+limit-1 numbered, cut on a line boundary to fit what the
 * model is shown of a tool result (MAX_TOOL_RESULT_CHARS), saying where to read on.
 */
export function numbered(path: string, text: string, offset: number, limit: number): string {
  const lines = text.split('\n')
  if (offset > lines.length) return `${path} has ${lines.length} lines; offset ${offset} is past the end.`
  const out: string[] = []
  let size = 0
  let last = offset - 1
  for (let i = offset - 1; i < Math.min(lines.length, offset - 1 + limit); i++) {
    const line = `${i + 1}| ${lines[i]}`
    if (size + line.length > READ_PAGE_CHARS && out.length) break
    out.push(line)
    size += line.length + 1
    last = i + 1
  }
  const more = last < lines.length ? `\n…more: read on with offset ${last + 1}.` : ''
  const range = offset > 1 || more ? ` (lines ${offset}-${last} of ${lines.length})` : ''
  return `${path}${range}\n${out.join('\n')}${more}`
}

async function editFile(args: Record<string, unknown>, context: ToolContext): Promise<McpToolResult> {
  const path = resolve(skillWorkspace(), str(args, 'path').trim())
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${path} does not exist`)
  let from = typeof args.old_string === 'string' ? args.old_string : ''
  let to = typeof args.new_string === 'string' ? args.new_string : ''
  if (!from) throw new Error('old_string is empty; use write_file for a new file')
  const text = readFileSync(path, 'utf8')
  // Models write \n; Windows files often have \r\n.
  if (!text.includes(from) && text.includes('\r\n') && text.includes(from.replace(/\r?\n/g, '\r\n'))) {
    from = from.replace(/\r?\n/g, '\r\n')
    to = to.replace(/\r?\n/g, '\r\n')
  }
  const count = text.split(from).length - 1
  if (!count) throw new Error(`old_string is not in ${path}. Read the file again and copy the text exactly.`)
  if (count > 1 && args.replace_all !== true) throw new Error(`old_string appears ${count} times in ${path}. Add surrounding text to make it unique, or set replace_all.`)
  await approveFile(path, true, context.chatId)
  const at = text.indexOf(from)
  const edited = args.replace_all === true ? text.split(from).join(to) : text.slice(0, at) + to + text.slice(at + from.length)
  recordChange(context.chatId, context.messageId, path)
  writeFileSync(path, edited, 'utf8')
  // The first change with a few lines either side, so the model sees it landed without reading the file again.
  const first = edited.slice(0, at).split('\n').length
  const changed = to.split('\n').length
  return result(`Edited ${path} (${count > 1 ? `${count} replacements` : '1 replacement'}).\n${numbered(path, edited.replace(/\r\n/g, '\n'), Math.max(1, first - 3), changed + 6).split('\n').slice(1).join('\n')}`)
}

/** An image for the model, scaled down to IMAGE_EDGE, after a line saying what it is. */
function imageResult(label: string, image: NativeImage, jpeg = false): McpToolResult {
  const { width, height } = image.getSize()
  const scale = Math.min(1, IMAGE_EDGE / Math.max(width, height))
  const shown = scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' }) : image
  const data = (jpeg ? shown.toJPEG(90) : shown.toPNG()).toString('base64')
  const size = scale < 1 ? ` (shown at ${shown.getSize().width}×${shown.getSize().height})` : ''
  return { content: [{ type: 'text', text: `${label}, ${width}×${height} px${size}` }, { type: 'image', data, mimeType: jpeg ? 'image/jpeg' : 'image/png' }], isError: false }
}

async function render(args: Record<string, unknown>, context: ToolContext): Promise<McpToolResult> {
  const chatId = context.chatId
  const output = resolve(skillWorkspace(), str(args, 'output').trim())
  const kind = extname(output).toLowerCase() === '.png' ? 'png' : extname(output).toLowerCase() === '.pdf' ? 'pdf' : null
  if (!kind) throw new Error('output must end in .pdf or .png')
  const html = typeof args.html === 'string' && args.html.trim() ? args.html : undefined
  const file = !html && typeof args.file === 'string' && args.file.trim() ? resolve(skillWorkspace(), args.file.trim()) : undefined
  if (!html && !file) throw new Error('Give html or file')
  if (file) {
    if (!existsSync(file)) throw new Error(`${file} does not exist`)
    await approveFile(file, false, chatId)
  }
  await approveFile(output, true, chatId)
  mkdirSync(skillWorkspace(), { recursive: true })
  const width = typeof args.width === 'number' && args.width >= 200 && args.width <= 4000 ? Math.round(args.width) : undefined
  const out = await renderHtml({ html, file, base: skillWorkspace(), folders: [skillWorkspace(), userDataPath('Attachments')] }, kind, width)
  mkdirSync(dirname(output), { recursive: true })
  recordChange(context.chatId, context.messageId, output)
  if (out.kind === 'pdf') {
    writeFileSync(output, out.bytes)
    return result(`Saved a ${out.pages}-page PDF to ${output}`)
  }
  writeFileSync(output, out.image.toPNG())
  return imageResult(`Saved ${output}${out.cut ? ' (cut at 10000 px tall)' : ''}`, out.image)
}

async function writeFile(pathArg: string, content: string, context: ToolContext): Promise<McpToolResult> {
  const path = resolve(skillWorkspace(), pathArg.trim())
  await approveFile(path, true, context.chatId)
  mkdirSync(dirname(path), { recursive: true })
  recordChange(context.chatId, context.messageId, path)
  writeFileSync(path, content, 'utf8')
  return result(`Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${path}`)
}

/** Command patterns allowed for the rest of a chat ("Allow for this chat"). */
const chatRules = new Map<string, string[]>()

/** The user's command rules, with the old exact-command list moved in on first use. */
export function commandRules(): CommandRule[] {
  const rules = settings.get('commandRules') ?? []
  const legacy = settings.get('allowedCommands') ?? []
  if (!legacy.length) return rules
  const moved = [...rules, ...legacy.filter((c) => !rules.some((r) => r.pattern === c)).map((pattern) => ({ pattern, effect: 'allow' as const }))]
  settings.set({ commandRules: moved, allowedCommands: [] })
  return moved
}

/** The environment commands and scripts run in: "python" and "pip" are the bundled Python, output is UTF-8. */
export function commandEnv(): NodeJS.ProcessEnv {
  const python = dirname(pythonExecutable())
  const path = [python, join(python, 'Scripts'), process.env.PATH ?? process.env.Path ?? ''].join(delimiter)
  return { ...process.env, PATH: path, Path: path, PYTHONIOENCODING: 'utf-8', GIT_TERMINAL_PROMPT: '0' }
}

async function runCommand(command: string, cwdArg?: string, chatId?: string): Promise<string> {
  const cwd = resolve(cwdArg?.trim() || skillWorkspace())
  mkdirSync(skillsDir(), { recursive: true })
  mkdirSync(skillWorkspace(), { recursive: true })
  if (!existsSync(cwd)) throw new Error(`${cwd} does not exist`)
  const rules = commandRules()
  const decision = decide(command, rules, chatId ? (chatRules.get(chatId) ?? []) : [])
  if (decision.effect === 'deny') throw new Error(`Not run: the user's rule "${decision.rule}" blocks it. Ask them how to continue.`)
  if (decision.effect === 'ask') {
    // What "always" and "this chat" would allow from now on: the program (and subcommand), like "python *".
    const proposed = proposeRules(command, rules)
    const scope = proposed.length ? proposed.join(', ') : command
    const answer = await askApproval(chatId, {
      title: 'Run this command on your computer?',
      command,
      detail: decision.hardline ? `In ${cwd}. It ${decision.hardline}, so it always asks.` : `In ${cwd}`,
      alwaysLabel: decision.hardline || !proposed.length ? '' : `Always allow ${scope}`,
      ...(decision.hardline ? {} : { chatLabel: 'Allow for this chat' })
    })
    if (answer === 'deny') throw new Error('The user denied this command. Ask them how to continue.')
    if (answer === 'always' && proposed.length) settings.set({ commandRules: [...rules, ...proposed.map((pattern) => ({ pattern, effect: 'allow' as const }))] })
    if (answer === 'chat' && chatId) chatRules.set(chatId, [...(chatRules.get(chatId) ?? []), ...(proposed.length ? proposed : [command])])
  }
  const [shell, args] =
    process.platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]]
      : ['/bin/sh', ['-c', command]]
  return new Promise((done, fail) => {
    const proc = spawn(shell, args, { cwd, windowsHide: true, env: commandEnv() })
    let out = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, COMMAND_TIMEOUT_MS)
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (out += d))
    proc.on('error', (e) => {
      clearTimeout(timer)
      fail(e)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      const tail = timedOut ? `\n(stopped after ${COMMAND_TIMEOUT_MS / 60_000} minutes)` : ''
      done(cut(`exit code: ${code}\n${out.trim()}${tail}`, MAX_OUTPUT_CHARS))
    })
    proc.stdin.end()
  })
}

/** The chat a tool call comes from, so questions to the user appear in it. */
export interface ToolContext {
  chatId?: string
  /** The reply the call belongs to. */
  messageId?: string
}

export async function callBuiltinTool(name: string, args: Record<string, unknown>, context: ToolContext = {}): Promise<McpToolResult> {
  // The tool's fixed name only (memory_save, skill_load, web_fetch...), never its arguments.
  analytics.track('builtin_tool_used', { tool: name })
  try {
    switch (name) {
      case 'memory_save': {
        const kind = args.kind === 'user' || args.kind === 'note' ? args.kind : undefined
        const item = memoryStore.add(str(args, 'text'), 'model', kind)
        return result(`Saved memory ${item.id}: ${item.text}`)
      }
      case 'memory_update': {
        const item = memoryStore.update(str(args, 'id'), str(args, 'text'), 'model')
        return result(`Updated memory ${item.id}: ${item.text}`)
      }
      case 'memory_forget':
        return memoryStore.remove(str(args, 'id')) ? result('Forgotten.') : result(`No memory with id ${String(args.id)}`, true)
      case 'skill_load':
        return result(skillStore.load(str(args, 'skill')))
      case 'skill_read_file':
        return result(skillStore.readFile(str(args, 'skill'), str(args, 'path')))
      case 'skill_run_script': {
        const list = Array.isArray(args.args) ? args.args.map(String) : []
        const stdin = typeof args.stdin === 'string' ? args.stdin : undefined
        return result(await skillStore.runScript(str(args, 'skill'), str(args, 'script'), list, stdin, context.chatId))
      }
      case 'todo_update': {
        // The list itself is drawn from this call's arguments in the chat; the model just needs to know it landed.
        const items = Array.isArray(args.items) ? (args.items as { status?: string }[]) : []
        return result(`To-do list updated: ${items.filter((i) => i.status === 'done').length} of ${items.length} done.`)
      }
      case 'ask_user': {
        if (!context.chatId) throw new Error('There is no chat to ask in')
        const options = (Array.isArray(args.options) ? args.options.map(String) : []).filter((o) => o.trim()).slice(0, 6)
        const answer = await approvals.question(context.chatId, str(args, 'question'), options, args.other !== false)
        return result(answer === null ? 'The user dismissed the question without answering.' : `The user answered: ${answer}`)
      }
      case 'chat_search': {
        const query = str(args, 'query')
        const limit = Math.max(1, Math.min(20, Math.floor(Number(args.limit) || 8)))
        return result(formatHits(query, searchChats(query, { exclude: context.chatId, limit })))
      }
      case 'chat_read':
        return result(readChat(str(args, 'chat'), typeof args.around === 'number' ? args.around : undefined))
      case 'skill_create': {
        const skill = skillStore.create(str(args, 'name'), str(args, 'description'), str(args, 'body'))
        return result(`Saved the skill ${skill.name} in ${skill.folder}. Later chats see it in their skill list.`)
      }
      case 'skill_edit':
        return result(skillStore.edit(str(args, 'skill'), str(args, 'old_string'), typeof args.new_string === 'string' ? args.new_string : '', args.replace_all === true))
      case 'skill_write_file':
        return result(skillStore.writeSkillFile(str(args, 'skill'), str(args, 'path'), typeof args.content === 'string' ? args.content : ''))
      case 'web_fetch':
        return result(await webFetch(str(args, 'url')))
      case 'read_file':
        return await readFile(str(args, 'path'), context, args.offset, args.limit)
      case 'write_file':
        return await writeFile(str(args, 'path'), typeof args.content === 'string' ? args.content : '', context)
      case 'edit_file':
        return await editFile(args, context)
      case 'render_html':
        return await render(args, context)
      case 'run_command':
        return result(await runCommand(str(args, 'command'), typeof args.cwd === 'string' ? args.cwd : undefined, context.chatId))
      case 'skills_refresh': {
        skillStore.changed()
        const skills = skillStore.list()
        return result(
          skills.length
            ? `Skills folder: ${skillsDir()}\n${skills.map((s) => `- ${s.name} (${s.id})${s.enabled ? '' : ' [off]'}: ${s.description}`).join('\n')}`
            : `No skills in ${skillsDir()} yet. Each skill needs its own folder there with a SKILL.md inside.`
        )
      }
    }
    return result(`Unknown tool ${name}`, true)
  } catch (err) {
    return result((err as Error).message, true)
  }
}

/** The part of the system prompt Llama Run adds to every turn: memories and the skill list. */
/** Skill descriptions in the system prompt are kept short: with many skills installed they add up fast. */
const MAX_SKILL_DESCRIPTION = 250

function shorten(text: string): string {
  return text.length <= MAX_SKILL_DESCRIPTION ? text : `${text.slice(0, MAX_SKILL_DESCRIPTION - 1).trimEnd()}…`
}

export function builtinInstructions(options: BuiltinOptions = {}): string {
  const parts: string[] = [
    [
      '## Showing things',
      'The chat draws some code blocks instead of printing them: ```mermaid as a diagram, ```svg as a picture, ```html as a live page.',
      'For flowcharts, sequence diagrams, timelines, mind maps and similar, use a ```mermaid block. Use ```html only for something interactive.'
    ].join('\n')
  ]
  if (memoryOn()) {
    const items = memoryStore.list()
    // Each kind with how full it is, so the model knows when to merge before saving more.
    const group = (kind: MemoryKind, title: string): string => {
      const of = items.filter((m) => kindOf(m) === kind)
      return of.length ? `${title} (${memoryStore.used(kind)} of ${MEMORY_BUDGET[kind]} characters; id: entry):\n${of.map((m) => `- ${m.id}: ${m.text}`).join('\n')}` : ''
    }
    parts.push(
      [
        '## Memory',
        'You remember things between chats. Use them when they help, without announcing it.',
        'When the user tells you something lasting about themselves, or asks you to remember something, save it with memory_save. Fix outdated memories with memory_update and delete them with memory_forget when asked. Never save passwords, keys or other secrets.',
        items.length ? [group('user', 'About the user'), group('note', 'Your notes')].filter(Boolean).join('\n') : 'You do not remember anything yet.'
      ].join('\n')
    )
  }
  if (skillsOn()) {
    const skills = skillStore.active()
    const lines = ['## Skills']
    if (skills.length) {
      lines.push(
        'Skills are folders of instructions and scripts for particular tasks. When a request matches one, call skill_load first and follow its instructions; run its Python scripts with skill_run_script.',
        `Files scripts write go to ${skillWorkspace()}. Tell the user where to find them.`,
        'Available skills:',
        // Skills marked disable-model-invocation only run when the user types their /command.
        ...skills.filter((s) => s.modelInvocable).map((s) => `- ${s.name}: ${shorten(s.description) || '(no description)'}`)
      )
    }
    if (lines.length > 1) parts.push(lines.join('\n'))
  }
  if (options.install) parts.push(installNote())
  return parts.join('\n\n')
}

/** For turns that install a skill: where skills go. Kept apart so the rest of the instructions stay the same across turns. */
export function installNote(): string {
  return `To install a skill the user links to: read its README with web_fetch and follow the install steps with run_command, so each skill ends up as its own folder with a SKILL.md inside ${skillsDir()}. Then call skills_refresh and tell the user what was installed.`
}

/** The first message of an "Install with AI" chat. */
export function installBrief(source: string): string {
  return [
    `Install the skill (or skills) from ${source}.`,
    'Read its README with web_fetch and follow its install instructions with run_command.',
    `Each skill must end up as its own folder containing a SKILL.md inside ${skillsDir()}. If the README is written for another app (like Claude Code), adapt its steps to put the skill there instead.`,
    "When you're done, call skills_refresh and tell me what was installed and how to use it."
  ].join('\n')
}

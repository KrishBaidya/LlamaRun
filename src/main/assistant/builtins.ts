import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import type { McpToolInfo } from '@shared/types'
import type { McpToolResult } from '../mcp/manager'
import { memoryStore } from '../memory/store'
import { pythonExecutable } from '../paths'
import { settings } from '../settings'
import { cut, skillsDir, skillStore, skillWorkspace } from '../skills/store'
import { askApproval } from './approval'

/**
 * Tools Llama Run itself gives the model, next to the MCP servers' and plugins':
 * memory (what it knows about the user), skills (SKILL.md folders it can load
 * and whose Python scripts it can run), and, like Claude Code, reading web
 * pages and running commands (each one approved) to install skills from a README.
 */

const SERVER = 'Llama Run'
const COMMAND_TIMEOUT_MS = 10 * 60_000
const MAX_OUTPUT_CHARS = 16_000
const MAX_PAGE_CHARS = 40_000

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
    'Remember a lasting fact about the user (name, job, preferences, projects, people, how they like answers). One short fact per call, starting with "User" or their name, e.g. "User prefers metric units". Use "they" or the name, never a guessed he/she. Not for details of the current task only.',
    { text: { type: 'string', description: 'The fact, e.g. "Prefers metric units".' } },
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

const INSTALL_TOOLS: McpToolInfo[] = [
  tool(
    'web_fetch',
    'Read a web page or file as text, e.g. a README. GitHub repository links return the README.',
    { url: { type: 'string' } },
    ['url']
  ),
  tool(
    'run_command',
    `Run a ${process.platform === 'win32' ? 'PowerShell' : 'shell'} command on the user's computer (git clone, pip install, an install script…) and get its output. The user approves each command. Runs in the Skills folder unless cwd is given. "python" and "pip" are Llama Run's bundled Python.`,
    { command: { type: 'string' }, cwd: { type: 'string', description: 'Working folder (absolute).' } },
    ['command']
  ),
  tool('skills_refresh', 'Rescan the Skills folder after installing or changing a skill, and list what is installed.', {}, [])
]

const memoryOn = (): boolean => settings.get('memoryEnabled') !== false
const skillsOn = (): boolean => settings.get('skillsEnabled') !== false

export interface BuiltinOptions {
  /** Offer run_command and web_fetch (typed turns only, never plugin-sent ones). */
  shell?: boolean
}

export function builtinTools(options: BuiltinOptions = {}): McpToolInfo[] {
  return [
    ...(memoryOn() ? MEMORY_TOOLS : []),
    ...(skillsOn() && skillStore.active().length ? SKILL_TOOLS : []),
    ...(skillsOn() && options.shell ? INSTALL_TOOLS : [])
  ]
}

const NAMES = new Set([...MEMORY_TOOLS, ...SKILL_TOOLS, ...INSTALL_TOOLS].map((t) => t.name))

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

async function runCommand(command: string, cwdArg?: string, chatId?: string): Promise<string> {
  const cwd = resolve(cwdArg?.trim() || skillsDir())
  mkdirSync(skillsDir(), { recursive: true })
  if (!existsSync(cwd)) throw new Error(`${cwd} does not exist`)
  const allowed = settings.get('allowedCommands') ?? []
  if (!allowed.includes(command)) {
    const answer = await askApproval(chatId, {
      title: 'Run this command on your computer?',
      command,
      detail: `In ${cwd}`,
      alwaysLabel: 'Always allow this command'
    })
    if (answer === 'deny') throw new Error('The user denied this command. Ask them how to continue.')
    if (answer === 'always') settings.set({ allowedCommands: [...allowed, command] })
  }
  const python = dirname(pythonExecutable())
  const path = [python, join(python, 'Scripts'), process.env.PATH ?? process.env.Path ?? ''].join(delimiter)
  const [shell, args] =
    process.platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]]
      : ['/bin/sh', ['-c', command]]
  return new Promise((done, fail) => {
    const proc = spawn(shell, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, PATH: path, Path: path, PYTHONIOENCODING: 'utf-8', GIT_TERMINAL_PROMPT: '0' }
    })
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
}

export async function callBuiltinTool(name: string, args: Record<string, unknown>, context: ToolContext = {}): Promise<McpToolResult> {
  try {
    switch (name) {
      case 'memory_save': {
        const item = memoryStore.add(str(args, 'text'), 'model')
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
      case 'web_fetch':
        return result(await webFetch(str(args, 'url')))
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
    parts.push(
      [
        '## Memory',
        'You remember things about the user between chats. Use them when they help, without announcing it.',
        'When the user tells you something lasting about themselves, or asks you to remember something, save it with memory_save. Fix outdated memories with memory_update and delete them with memory_forget when asked. Never save passwords, keys or other secrets.',
        items.length
          ? `What you remember (id: fact):\n${items.map((m) => `- ${m.id}: ${m.text}`).join('\n')}`
          : 'You do not remember anything about the user yet.'
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
    if (options.shell) {
      lines.push(
        `To install a skill the user links to: read its README with web_fetch and follow the install steps with run_command, so each skill ends up as its own folder with a SKILL.md inside ${skillsDir()}. Then call skills_refresh and tell the user what was installed.`
      )
    }
    if (lines.length > 1) parts.push(lines.join('\n'))
  }
  return parts.join('\n\n')
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

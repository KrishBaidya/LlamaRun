import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type { AgentInfo, AgentLocation, ThinkingChoice } from '@shared/types'
import { userDataPath } from '../paths'
import { parseFrontMatter } from '../skills/frontMatter'

/**
 * Custom agents, like OpenCode's agents and Claude Code's .claude/agents: a
 * Markdown file whose front matter says what the agent is for, which model it
 * uses and which tools it may call, and whose body is its prompt. Llama Run's
 * own are in userData/agents (made in Settings > Agents); Claude Code's and
 * OpenCode's user-level agents are read as they are.
 */

/** Tools every agent may use unless its file lists others: reading and looking things up, nothing that changes anything. */
export const READ_ONLY_TOOLS = [
  'read_file',
  'file_list',
  'file_glob',
  'file_grep',
  'web_fetch',
  'web_search',
  'chat_search',
  'chat_read',
  'skill_load',
  'skill_read_file',
  'todo_update'
]

/** Names in an agent's tools list that stand for a group. */
const GROUPS: Record<string, string[]> = {
  // Claude Code's tool names, so its agents keep the access they were written for.
  Read: ['read_file'],
  Glob: ['file_glob', 'file_list'],
  Grep: ['file_grep'],
  LS: ['file_list'],
  WebFetch: ['web_fetch'],
  WebSearch: ['web_search'],
  Write: ['write_file'],
  Edit: ['edit_file'],
  MultiEdit: ['edit_file'],
  Bash: ['run_command', 'process_output', 'process_stop'],
  TodoWrite: ['todo_update'],
  // OpenCode's.
  read: ['read_file'],
  glob: ['file_glob'],
  grep: ['file_grep'],
  list: ['file_list'],
  webfetch: ['web_fetch'],
  write: ['write_file'],
  edit: ['edit_file'],
  patch: ['edit_file'],
  bash: ['run_command', 'process_output', 'process_stop'],
  todowrite: ['todo_update']
}

export function agentRoots(): { dir: string; location: AgentLocation }[] {
  const home = homedir()
  return [
    { dir: userDataPath('agents'), location: 'llamarun' },
    { dir: join(home, '.claude', 'agents'), location: 'claude' },
    { dir: join(home, '.config', 'opencode', 'agent'), location: 'opencode' },
    { dir: join(home, '.config', 'opencode', 'agents'), location: 'opencode' }
  ]
}

/** The raw front matter block, for the values parseFrontMatter flattens (lists and maps). */
function rawBlock(text: string, key: string): string[] {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return []
  const lines = match[1].split(/\r?\n/)
  const at = lines.findIndex((l) => new RegExp(`^${key}:\\s*$`).test(l))
  if (at < 0) return []
  const out: string[] = []
  for (let i = at + 1; i < lines.length && (/^\s+\S/.test(lines[i]) || !lines[i].trim()); i++) if (lines[i].trim()) out.push(lines[i].trim())
  return out
}

/**
 * An agent's tools as Llama Run tool names: "tools: Read, Grep" (Claude Code),
 * a YAML list, or a map of name: true/false (OpenCode). "*" is every tool.
 * Unknown names are kept as they are (an MCP or plugin tool). Nothing listed: read-only.
 */
export function parseTools(text: string, inline: string | undefined): string[] | '*' {
  let names: string[] = []
  if (inline && inline !== '') names = inline.replace(/^\[|\]$/g, '').split(',')
  else {
    const block = rawBlock(text, 'tools')
    if (block.every((l) => l.startsWith('-'))) names = block.map((l) => l.slice(1))
    else names = block.filter((l) => /:\s*true\s*$/i.test(l)).map((l) => l.split(':')[0])
  }
  names = names.map((n) => n.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  if (names.includes('*')) return '*'
  if (!names.length) return READ_ONLY_TOOLS
  return [...new Set(names.flatMap((n) => GROUPS[n] ?? [n]))]
}

const THINKING = new Set(['off', 'on', 'minimal', 'low', 'medium', 'high'])

export function parseAgent(file: string, text: string, location: AgentLocation): AgentInfo | null {
  const { data, body } = parseFrontMatter(text)
  const id = basename(file, extname(file))
  const prompt = body.trim()
  if (!prompt && !data.description) return null
  // OpenCode's primary agents are modes for its own UI; subagents and "all" are what agent_run can use.
  const thinking = data.thinking && THINKING.has(data.thinking) ? (data.thinking as ThinkingChoice) : undefined
  return {
    id: `${location}:${id}`,
    name: (data.name || id).trim(),
    description: (data.description ?? '').trim(),
    // Claude Code's sonnet/opus/haiku/inherit aren't Llama Run models: those agents use the chat's.
    ...(data.model && !/^(inherit|sonnet|opus|haiku)$/i.test(data.model) ? { model: data.model.trim() } : {}),
    tools: parseTools(text, data.tools),
    ...(thinking ? { thinking } : {}),
    prompt,
    location,
    file
  }
}

class AgentStore {
  list(): AgentInfo[] {
    const seen = new Set<string>()
    const out: AgentInfo[] = []
    for (const { dir, location } of agentRoots()) {
      if (!existsSync(dir)) continue
      let files: string[]
      try {
        files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'))
      } catch {
        continue
      }
      for (const f of files.sort()) {
        try {
          const agent = parseAgent(join(dir, f), readFileSync(join(dir, f), 'utf8'), location)
          // The first of a name wins: Llama Run's own over Claude Code's over OpenCode's.
          if (!agent || seen.has(agent.name.toLowerCase())) continue
          seen.add(agent.name.toLowerCase())
          out.push(agent)
        } catch {
          /* unreadable file */
        }
      }
    }
    return out
  }

  /** By id, or by name (what the model passes). */
  find(nameOrId: string): AgentInfo | undefined {
    const key = nameOrId.trim().toLowerCase()
    return this.list().find((a) => a.id.toLowerCase() === key || a.name.toLowerCase() === key)
  }

  /** Saves one of Llama Run's own agents (a new one or an edit). */
  save(input: { id?: string; name: string; description: string; model?: string; tools: string[] | '*'; thinking?: ThinkingChoice; prompt: string }): AgentInfo {
    const name = input.name.trim()
    if (!/^[\w][\w .-]{0,60}$/.test(name)) throw new Error('Give the agent a short name: letters, numbers, spaces, dots and dashes.')
    if (!input.description.trim()) throw new Error('Say what the agent is for: the description decides when it is used.')
    const dir = userDataPath('agents')
    mkdirSync(dir, { recursive: true })
    const slug = name.toLowerCase().replace(/[^\w.-]+/g, '-')
    const previous = input.id ? this.find(input.id) : undefined
    if (previous && previous.location !== 'llamarun') throw new Error(`${previous.name} comes from ${previous.location === 'claude' ? 'Claude Code' : 'OpenCode'}; edit it there.`)
    const clash = this.find(name)
    if (clash && clash.id !== previous?.id && clash.location === 'llamarun') throw new Error(`There is already an agent called ${clash.name}.`)
    const tools = input.tools === '*' ? '*' : input.tools.join(', ')
    const lines = [
      '---',
      `name: ${name}`,
      `description: ${input.description.replace(/\s+/g, ' ').trim()}`,
      ...(input.model ? [`model: ${input.model}`] : []),
      `tools: ${tools}`,
      ...(input.thinking ? [`thinking: ${input.thinking}`] : []),
      '---',
      '',
      input.prompt.trim(),
      ''
    ]
    const file = join(dir, `${slug}.md`)
    if (previous && previous.file !== file) rmSync(previous.file, { force: true })
    writeFileSync(file, lines.join('\n'), 'utf8')
    return this.find(`llamarun:${slug}`)!
  }

  remove(id: string): void {
    const agent = this.find(id)
    if (!agent) return
    if (agent.location !== 'llamarun') throw new Error(`${agent.name} comes from ${agent.location === 'claude' ? 'Claude Code' : 'OpenCode'}; remove it there.`)
    rmSync(agent.file, { force: true })
  }
}

export const agentStore = new AgentStore()

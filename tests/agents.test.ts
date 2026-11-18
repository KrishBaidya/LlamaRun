import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-agents-'))
const home = mkdtempSync(join(tmpdir(), 'llamarun-home-'))
process.env.USERPROFILE = home
process.env.HOME = home

vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.' } }))
const { agentStore, allowedTools, parseAgent, parseTools, READ_ONLY_TOOLS } = await import('../src/main/assistant/agents')

mkdirSync(join(home, '.claude', 'agents'), { recursive: true })
writeFileSync(
  join(home, '.claude', 'agents', 'code-reviewer.md'),
  '---\nname: code-reviewer\ndescription: Reviews code for bugs\ntools: Read, Grep, Glob\nmodel: sonnet\n---\n\nYou review code carefully.\n'
)
mkdirSync(join(home, '.config', 'opencode', 'agent'), { recursive: true })
writeFileSync(
  join(home, '.config', 'opencode', 'agent', 'docs.md'),
  '---\ndescription: Writes docs\nmode: subagent\ntools:\n  write: true\n  edit: true\n  bash: false\n---\nWrite clear docs.\n'
)

describe('agent files', () => {
  it('maps Claude Code and OpenCode tool names to Llama Run tools', () => {
    expect(parseTools('', 'Read, Grep, Glob')).toEqual(['read_file', 'file_grep', 'file_glob', 'file_list'])
    expect(parseTools('---\ntools:\n  - Read\n  - Bash\n---\n', undefined)).toEqual(['read_file', 'run_command', 'process_output', 'process_stop'])
    expect(parseTools('---\ntools:\n  write: true\n  bash: false\n---\n', undefined)).toEqual(['write_file'])
    expect(parseTools('', '*')).toBe('*')
    expect(parseTools('', undefined)).toEqual(READ_ONLY_TOOLS)
  })

  it("ignores Claude Code's model aliases and keeps real model ids", () => {
    expect(parseAgent('a.md', '---\ndescription: x\nmodel: opus\n---\nhi', 'claude')?.model).toBeUndefined()
    expect(parseAgent('a.md', '---\ndescription: x\nmodel: gemini-3.8-flash\n---\nhi', 'llamarun')?.model).toBe('gemini-3.8-flash')
  })

  it('lists Llama Run, Claude Code and OpenCode agents', () => {
    const list = agentStore.list()
    expect(list.map((a) => [a.name, a.location])).toEqual([
      ['code-reviewer', 'claude'],
      ['docs', 'opencode']
    ])
    expect(agentStore.find('Code-Reviewer')?.prompt).toBe('You review code carefully.')
  })

  it("saves, edits and removes Llama Run's own, but not others'", () => {
    const saved = agentStore.save({ name: 'Researcher', description: 'Finds sources', tools: ['web_search', 'web_fetch'], prompt: 'Cite everything.' })
    expect(saved.id).toBe('llamarun:researcher')
    expect(saved.tools).toEqual(['web_search', 'web_fetch'])
    const edited = agentStore.save({ id: saved.id, name: 'Researcher', description: 'Finds good sources', tools: '*', prompt: 'Cite.' })
    expect(edited.tools).toBe('*')
    expect(agentStore.list()[0].name).toBe('Researcher')
    expect(() => agentStore.remove('claude:code-reviewer')).toThrow('Claude Code')
    agentStore.remove(saved.id)
    expect(agentStore.find('Researcher')).toBeUndefined()
    expect(() => agentStore.save({ name: 'x', description: '', tools: '*', prompt: '' })).toThrow('description')
  })
})

describe('plan mode and chat agents', () => {
  const tools = ['read_file', 'file_grep', 'write_file', 'run_command', 'ask_user', 'agent_run', 'todo_update', 'some_mcp_tool'].map((name) => ({ name }))
  it('plan mode keeps reading, asking and read-only helpers only', () => {
    expect(allowedTools(tools, { plan: true }).map((t) => t.name)).toEqual(['read_file', 'file_grep', 'ask_user', 'agent_run', 'todo_update'])
  })
  it("a chat's agent gets its own tools plus asking and the to-do list", () => {
    expect(allowedTools(tools, { allow: ['write_file', 'some_mcp_tool'] }).map((t) => t.name)).toEqual(['write_file', 'ask_user', 'todo_update', 'some_mcp_tool'])
    expect(allowedTools(tools, { allow: '*' })).toHaveLength(tools.length)
    expect(allowedTools(tools, { allow: ['write_file'], plan: true }).map((t) => t.name)).toEqual(['ask_user', 'todo_update'])
  })
})

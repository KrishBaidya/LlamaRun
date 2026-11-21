import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-slash-'))
process.env.LLAMARUN_SKILLS_DIR = join(userData, 'shared')
process.env.LLAMARUN_CLAUDE_SKILLS_DIR = join(userData, 'claude')
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' } }))
const { skillStore } = await import('../src/main/skills/store')
const { mcp } = await import('../src/main/mcp/manager')

describe('/ commands from plugins and MCP servers', () => {
  it("lists a plugin's skills/ folder as its skills, which can't be removed on their own", () => {
    const dir = join(userData, 'Plugins', 'jira', 'skills')
    mkdirSync(join(dir, 'triage'), { recursive: true })
    writeFileSync(join(dir, 'triage', 'SKILL.md'), '---\nname: triage\ndescription: Triage new tickets\n---\nLook at the tickets.\n')
    skillStore.setPluginRoots(() => [{ dir, plugin: 'Jira' }])
    const skill = skillStore.list().find((s) => s.name === 'triage')
    expect(skill).toMatchObject({ location: 'plugin', plugin: 'Jira' })
    expect(skillStore.commands().find((c) => c.name === 'triage')?.plugin).toBe('Skill · Jira')
    expect(() => skillStore.remove(skill!.id)).toThrow('Jira plugin')
    skillStore.setPluginRoots(() => [])
    expect(skillStore.list().some((s) => s.name === 'triage')).toBe(false)
  })

  it("offers an MCP server's prompts as /server:prompt and fills their arguments", async () => {
    const getPrompt = vi.fn(async () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'Review PR 42 in detail' } }] }))
    ;(mcp as unknown as { connections: Map<string, unknown> }).connections.set('GitHub', {
      config: { name: 'GitHub' },
      client: { getPrompt },
      status: { name: 'GitHub', state: 'connected', toolCount: 0 },
      tools: [],
      prompts: [{ name: 'review_pr', description: 'Review a pull request', args: [{ name: 'number', required: true }, { name: 'focus', required: false }] }]
    })
    expect(mcp.commands()).toEqual([{ name: 'github:review_pr', description: 'Review a pull request', kind: 'mcp', plugin: 'MCP · GitHub', args: '<number> [focus]' }])
    expect(await mcp.runPrompt('/github:review_pr 42 security and tests')).toEqual({ name: 'github:review_pr', text: 'Review PR 42 in detail' })
    expect(getPrompt).toHaveBeenCalledWith({ name: 'review_pr', arguments: { number: '42', focus: 'security and tests' } })
    await expect(mcp.runPrompt('/github:review_pr')).rejects.toThrow('needs number')
    expect(await mcp.runPrompt('/github:nothing')).toBeNull()
  })
})

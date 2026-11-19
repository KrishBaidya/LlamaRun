import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '../src/shared/types'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-bundle-data-'))
const home = mkdtempSync(join(tmpdir(), 'llamarun-bundle-home-'))
process.env.USERPROFILE = home
process.env.HOME = home
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' } }))

const { inspectBundle, installBundle, listBundles, removeBundle } = await import('../src/main/plugins/claudeBundle')
const { loadHooks } = await import('../src/main/assistant/hooks')
const { skillStore, skillsDir } = await import('../src/main/skills/store')

/** A plugin folder with one of everything. */
const plugin = mkdtempSync(join(tmpdir(), 'llamarun-plugin-'))
const put = (rel: string, text: string): void => {
  mkdirSync(join(plugin, rel, '..'), { recursive: true })
  writeFileSync(join(plugin, rel), text)
}
put('.claude-plugin/plugin.json', JSON.stringify({ name: 'Code Kit', description: 'Review tools', version: '1.2.0' }))
put('skills/review-pr/SKILL.md', '---\nname: review-pr\ndescription: Review a pull request\n---\nRead the diff.\n')
put('commands/lint.md', '---\ndescription: Lint the project\nargument-hint: [path]\n---\nRun the linter on $ARGUMENTS.\n')
put('agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep\n---\nBe strict.\n')
put('hooks/hooks.json', JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/fmt.js' }] }], Notification: [] } }))
put('.mcp.json', JSON.stringify({ mcpServers: { db: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.js'] } } }))

describe('Claude Code plugin bundles', () => {
  it('shows everything a plugin adds before installing, then installs and removes it', async () => {
    const { token, preview } = await inspectBundle(plugin)
    expect(preview).toMatchObject({ name: 'Code Kit', version: '1.2.0', skills: ['review-pr'], commands: ['lint'], agents: ['reviewer'] })
    const root = join(userData, 'bundles', 'code-kit').replace(/\\/g, '/')
    expect(preview.hooks).toEqual([`PostToolUse (Write): node ${root}/fmt.js`])
    expect(preview.mcpServers).toEqual([`Code Kit:db: node ${root}/server.js`])

    const added: McpServerConfig[] = []
    const removed: string[] = []
    const deps = { addMcpServer: async (s: McpServerConfig) => void added.push(s), removeMcpServer: async (n: string) => void removed.push(n) }
    const info = await installBundle(token, deps)
    expect(existsSync(join(userData, 'bundles', 'code-kit', 'commands', 'lint.md'))).toBe(true)

    skillStore.changed()
    const lint = skillStore.list().find((s) => s.name === 'lint')
    expect(lint?.modelInvocable).toBe(false)
    expect(readFileSync(join(skillsDir(), 'code-kit-cmd-lint', 'SKILL.md'), 'utf8')).toContain('Run the linter on $ARGUMENTS.')
    expect(skillStore.list().some((s) => s.name === 'review-pr')).toBe(true)
    const reviewer = skillStore.list().find((s) => s.name === 'reviewer')
    expect(reviewer).toMatchObject({ description: 'Reviews code', modelInvocable: true })
    expect(readFileSync(join(skillsDir(), 'code-kit-agent-reviewer', 'SKILL.md'), 'utf8')).toContain('Be strict.')
    expect(loadHooks().PostToolUse?.[0].hooks[0].command).toBe(`node ${root}/fmt.js`)
    expect(added[0].data.Arguments).toEqual([`${root}/server.js`])
    expect(listBundles().map((b) => b.name)).toEqual(['Code Kit'])

    await removeBundle('Code Kit', deps)
    expect(removed).toEqual([info.mcpServers[0]])
    expect(loadHooks().PostToolUse).toBeUndefined()
    expect(existsSync(join(skillsDir(), 'code-kit-agent-reviewer'))).toBe(false)
    expect(existsSync(join(skillsDir(), 'code-kit-cmd-lint'))).toBe(false)
    expect(listBundles()).toEqual([])
  })

  it('refuses a folder that is not a plugin', async () => {
    await expect(inspectBundle(mkdtempSync(join(tmpdir(), 'llamarun-empty-')))).rejects.toThrow("isn't a Claude Code plugin")
  })
})

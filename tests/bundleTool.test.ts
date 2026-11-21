import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest, McpServerConfig } from '../src/shared/types'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-bundletool-'))
const home = mkdtempSync(join(tmpdir(), 'llamarun-bundletool-home-'))
process.env.USERPROFILE = home
process.env.HOME = home
process.env.LLAMARUN_SKILLS_DIR = join(home, 'skills')
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' }, safeStorage: { isEncryptionAvailable: () => false }, shell: {} }))
// The user already has this server.
writeFileSync(join(userData, 'mcp.json'), JSON.stringify([{ name: 'Deploys', mcpType: 'SSE', data: { Command: null, Arguments: [], EnvironmentVariables: {}, URL: 'https://mcp.example.com/' } }]))

const { runBundleInstall, bundleInstallTool } = await import('../src/main/plugins/bundleTool')
const { approvals } = await import('../src/main/assistant/approval')
const { skillsDir } = await import('../src/main/skills/store')

/** A plugin whose manifest lists its commands; _conventions.md is a shared part, not a command. */
const plugin = mkdtempSync(join(tmpdir(), 'llamarun-bundletool-plugin-'))
const put = (rel: string, text: string): void => {
  mkdirSync(join(plugin, rel, '..'), { recursive: true })
  writeFileSync(join(plugin, rel), text)
}
put('.claude-plugin/plugin.json', JSON.stringify({ name: 'deploy-kit', version: '1.0.0', commands: ['./commands/deploy.md'] }))
put('commands/deploy.md', '---\ndescription: Deploy it\n---\nDeploy $ARGUMENTS.\n')
put('commands/_conventions.md', 'Shared notes.\n')
put('.mcp.json', JSON.stringify({ mcpServers: { deploys: { type: 'http', url: 'https://mcp.example.com' } } }))

const answerNext = (answer: 'deny' | 'once', seen: ApprovalRequest[]): (() => void) => {
  const listener = (_chat: string, request: ApprovalRequest | null): void => {
    if (!request) return
    seen.push(request)
    approvals.answer(request.id, answer)
  }
  approvals.on('changed', listener)
  return () => approvals.off('changed', listener)
}

describe('claude_plugin_install', () => {
  const added: McpServerConfig[] = []
  const deps = { addMcpServer: async (s: McpServerConfig) => void added.push(s), removeMcpServer: async () => undefined }

  it('shows everything first and installs nothing when the user says no', async () => {
    expect(bundleInstallTool.name).toBe('claude_plugin_install')
    const seen: ApprovalRequest[] = []
    const stop = answerNext('deny', seen)
    const result = await runBundleInstall({ source: plugin }, 'chat-1', deps)
    stop()
    expect(result.isError).toBe(true)
    expect(seen[0].title).toBe('Install the deploy-kit plugin into Llama Run?')
    expect(seen[0].command).toContain('/deploy')
    expect(seen[0].command).not.toContain('_conventions')
    expect(seen[0].command).toContain('already added as Deploys, skipped')
    expect(existsSync(join(skillsDir(), 'deploy-kit-cmd-deploy'))).toBe(false)
  })

  it('installs into Llama Run once approved, without duplicating a server the user has', async () => {
    const stop = answerNext('once', [])
    const result = await runBundleInstall({ source: plugin }, 'chat-1', deps)
    stop()
    expect(result.isError).toBeFalsy()
    expect(JSON.stringify(result.content)).toContain('Installed deploy-kit into Llama Run.')
    expect(existsSync(join(skillsDir(), 'deploy-kit-cmd-deploy', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillsDir(), 'deploy-kit-cmd-_conventions'))).toBe(false)
    expect(added).toEqual([])
  })
})

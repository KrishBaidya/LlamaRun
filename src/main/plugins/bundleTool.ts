import type { BundlePreview, McpToolInfo } from '@shared/types'
import { approvals } from '../assistant/approval'
import type { McpToolResult } from '../mcp/manager'
import { cancelBundle, inspectBundle, installBundle, type BundleDeps } from './claudeBundle'

/**
 * claude_plugin_install: the model installs a Claude Code plugin into Llama
 * Run itself (skills, /commands, agents as skills, hooks, MCP servers), through
 * the same installer as Settings > Plugins. The user sees everything it adds
 * and approves it first, since hooks and MCP servers run code.
 */

export const BUNDLE_INSTALL = 'claude_plugin_install'

export const bundleInstallTool: McpToolInfo = {
  name: BUNDLE_INSTALL,
  server: 'Llama Run',
  description:
    'Install a Claude Code plugin into Llama Run: a GitHub repository, git URL, ZIP or folder with .claude-plugin/plugin.json (or skills/, commands/, agents/, hooks/ or .mcp.json). Its skills, /commands, agents (as skills), hooks and MCP servers are added to Llama Run. The user sees the full list and approves it first.',
  inputSchema: {
    type: 'object',
    properties: { source: { type: 'string', description: 'owner/repo, a git or GitHub URL (a subfolder link works), a .zip, or a local folder.' } },
    required: ['source']
  }
}

const text = (t: string, isError = false): McpToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) })

/** The install card's list: what each part of the plugin becomes. */
export function previewLines(p: BundlePreview): string {
  const section = (title: string, items: string[]): string[] => (items.length ? [`${title} (${items.length}):`, ...items.slice(0, 40).map((i) => `  ${i}`), ...(items.length > 40 ? [`  …and ${items.length - 40} more`] : [])] : [])
  return [
    `${p.name}${p.version ? ` v${p.version}` : ''}${p.description ? `: ${p.description}` : ''}`,
    ...section('Skills', p.skills),
    ...section('Commands', p.commands.map((c) => `/${c}`)),
    ...section('Agents, added as skills', p.agents),
    ...section('Hooks, run on your PC without asking', p.hooks),
    ...section('MCP servers, started with Llama Run', p.mcpServers)
  ].join('\n')
}

export async function runBundleInstall(args: Record<string, unknown>, chatId: string | undefined, deps: BundleDeps, signal?: AbortSignal): Promise<McpToolResult> {
  const source = typeof args.source === 'string' ? args.source.trim() : ''
  if (!source) return text('source is required', true)
  if (!chatId) return text('Plugins can only be installed from a chat.', true)
  let staged: Awaited<ReturnType<typeof inspectBundle>>
  try {
    staged = await inspectBundle(source)
  } catch (err) {
    return text((err as Error).message, true)
  }
  const { token, preview } = staged
  const answer = await approvals.ask(
    chatId,
    {
      title: `Install the ${preview.name} plugin into Llama Run?`,
      command: previewLines(preview),
      detail: preview.hooks.length || preview.mcpServers.length ? 'Its hooks and MCP servers run code on your PC.' : 'It adds skills and commands only.',
      alwaysLabel: ''
    },
    signal
  )
  if (answer === 'deny') {
    cancelBundle(token)
    return text(`The user chose not to install ${preview.name}.`, true)
  }
  try {
    const info = await installBundle(token, deps)
    return text(
      [
        `Installed ${info.name} into Llama Run.`,
        info.skills.length ? `Skills and commands (${info.skills.length}): ${info.skills.join(', ')}` : '',
        preview.hooks.length ? `Hooks: ${preview.hooks.length}` : '',
        info.mcpServers.length ? `MCP servers: ${info.mcpServers.join(', ')} (their tools are usable from the user's next message; one that needs signing in shows Sign in under Settings > MCP)` : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
  } catch (err) {
    return text(`Installing ${preview.name} failed: ${(err as Error).message}`, true)
  }
}

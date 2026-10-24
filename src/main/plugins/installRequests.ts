import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { McpDirectoryServer, McpServerConfig, PluginInspection, PluginPermission, UiNode } from '@shared/types'
import { configFromDirectoryEntry, loadMcpConfig } from '../mcp/config'
import { getDirectoryServer, listDirectory } from '../mcp/directory'
import { mcp } from '../mcp/manager'
import { inspectPlugin } from './install'
import { isPermission } from './permissions'
import { showPluginDialog } from './ui/dialogs'

/**
 * What plugins with the "install" permission can ask for: browsing the MCP
 * directory, adding an MCP server and installing a plugin. Adding and
 * installing always go through a dialog the app builds itself, showing exactly
 * what will run; the plugin only supplies a reason.
 */

export interface Requester {
  id: string
  name: string
}

/** The app's own dialog, raised for a plugin (closed if that plugin stops). */
function appDialog(requester: Requester, params: Record<string, unknown>): Promise<unknown> {
  return showPluginDialog({ id: requester.id, name: 'Llama Run' }, params)
}

const node = (type: string, props: Record<string, unknown>): UiNode => ({ type, props })
const SECRET = /key|token|secret|password|auth|credential/i
/** Values like "YOUR_API_KEY" or "<token>" in directory configs are placeholders, not defaults. */
const PLACEHOLDER = /^(<.*>|\$\{.*\}|your[_-].*|.*[_-]here|x{3,}|\.\.\.|)$/i

function quote(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

// ------------------------------------------------------------------- directory

/** A directory entry for a plugin: the run config resolved, and whether it's already set up. */
export function directoryEntry(server: McpDirectoryServer): Record<string, unknown> {
  const config = configFromDirectoryEntry(server.name, server.serverConfig)
  const installed = new Set(loadMcpConfig().map((s) => s.name.toLowerCase()))
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    longDescription: server.longDescription,
    category: server.category,
    author: server.author,
    verified: server.verified,
    requiresAuth: server.requiresAuth,
    tags: server.tags,
    features: server.features,
    documentationUrl: server.documentationUrl,
    repositoryUrl: server.repositoryUrl,
    config: {
      type: config.mcpType === 'SSE' ? 'url' : 'command',
      command: config.data.Command ?? undefined,
      args: config.data.Arguments ?? [],
      url: config.data.URL ?? undefined,
      env: Object.keys(config.data.EnvironmentVariables ?? {})
    },
    installed: installed.has(server.name.toLowerCase())
  }
}

export async function searchDirectory(p: Record<string, unknown>): Promise<Record<string, unknown>> {
  const page = await listDirectory({ search: p.search ? String(p.search) : '', cursor: p.cursor ? String(p.cursor) : null })
  return { servers: page.servers.map(directoryEntry), nextCursor: page.nextCursor }
}

export async function directoryServer(p: Record<string, unknown>): Promise<Record<string, unknown>> {
  return directoryEntry(await getDirectoryServer(String(p.id ?? '')))
}

export function listServers(): Record<string, unknown>[] {
  const statuses = new Map(mcp.statuses().map((s) => [s.name, s]))
  return loadMcpConfig().map((s) => {
    const status = statuses.get(s.name)
    return {
      name: s.name,
      state: status?.state ?? 'connecting',
      toolCount: status?.toolCount ?? 0,
      error: status?.error,
      command: s.data.Command ? [s.data.Command, ...(s.data.Arguments ?? [])].join(' ') : undefined,
      url: s.data.URL ?? undefined
    }
  })
}

// ------------------------------------------------------------------ MCP server

async function configFromRequest(p: Record<string, unknown>): Promise<{ config: McpServerConfig; about?: McpDirectoryServer }> {
  if (p.directory_id) {
    const about = await getDirectoryServer(String(p.directory_id))
    const config = configFromDirectoryEntry(p.name ? String(p.name) : about.name, about.serverConfig)
    if (!config.data.Command && !config.data.URL) throw new Error(`The directory entry "${about.name}" has no run configuration`)
    return { config, about }
  }
  const url = p.url ? String(p.url) : null
  const command = p.command ? String(p.command) : null
  if (!url && !command) throw new Error('Give a directory_id, a command or a url')
  if (url && !/^https?:\/\//i.test(url)) throw new Error('The url must start with http:// or https://')
  const args = Array.isArray(p.args) ? p.args.map(String) : []
  const env =
    p.env && typeof p.env === 'object' ? Object.fromEntries(Object.entries(p.env as object).map(([k, v]) => [k, String(v)])) : {}
  const name = p.name ? String(p.name) : command ? command.split(/[\\/]/).pop()! : new URL(url!).hostname
  return {
    config: {
      name,
      mcpType: command ? 'STDIO' : 'SSE',
      data: { Command: command, Arguments: args, EnvironmentVariables: env, URL: command ? null : url }
    }
  }
}

/**
 * Shows the user what the server runs (or connects to), lets them fill in its
 * environment variables, and adds it if they agree. Resolves with its status
 * once it has tried to connect, or null if they declined.
 */
export async function requestMcpServer(requester: Requester, p: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const { config, about } = await configFromRequest(p)
  const name = config.name.trim()
  if (!name) throw new Error('The server needs a name')
  if (loadMcpConfig().some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`An MCP server named "${name}" is already set up`)
  }

  const fields: UiNode[] = []
  if (about?.description) fields.push(node('Text', { text: about.description, tone: 'muted' }))
  if (config.mcpType === 'STDIO') {
    fields.push(
      node('Callout', {
        tone: 'warning',
        title: 'Runs this program on your computer',
        text: 'MCP servers run with your full access. Only add ones you trust.'
      }),
      node('Code', { text: [config.data.Command!, ...(config.data.Arguments ?? [])].map(quote).join(' '), language: 'shell' })
    )
  } else {
    fields.push(node('Callout', { tone: 'default', title: 'Connects to this server', text: config.data.URL }))
  }
  const env = config.data.EnvironmentVariables ?? {}
  for (const [key, value] of Object.entries(env)) {
    const placeholder = PLACEHOLDER.test(value.trim())
    fields.push(
      node('Input', {
        name: `env:${key}`,
        label: key,
        default: placeholder ? '' : value,
        placeholder: placeholder ? value || 'Value' : undefined,
        inputType: SECRET.test(key) ? 'password' : 'text'
      })
    )
  }
  if (Object.keys(env).length) {
    fields.push(node('Text', { text: 'You can change these later in Settings → MCP.', tone: 'muted', size: 'xs' }))
  }
  if (about?.documentationUrl || about?.repositoryUrl) {
    fields.push(node('Text', { text: `More about it: ${about.documentationUrl || about.repositoryUrl}`, tone: 'muted', size: 'xs' }))
  }

  const reason = p.reason ? String(p.reason).slice(0, 600) : ''
  const answer = (await appDialog(requester, {
    kind: 'form',
    title: `Add the MCP server “${name}”?`,
    message: `${requester.name} wants to add this server${reason ? `: ${reason}` : '.'}`,
    fields,
    confirmLabel: 'Add server',
    cancelLabel: 'Don’t add'
  })) as Record<string, unknown> | null
  if (!answer) return null

  config.name = name
  config.data.EnvironmentVariables = Object.fromEntries(Object.keys(env).map((key) => [key, String(answer[`env:${key}`] ?? '')]))
  await mcp.saveServer(config)
  return listServers().find((s) => s.name === name) ?? null
}

// ---------------------------------------------------------------------- plugin

/** Files under a folder, for the user to see what a plugin consists of. */
function listFiles(folder: string, limit = 12): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (out.length > limit || name.startsWith('.') || name === '__pycache__') continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(`${relative(folder, full).split(sep).join('/')}  (${Math.max(1, Math.round(statSync(full).size / 1024))} KB)`)
    }
  }
  walk(folder)
  return out.length > limit ? [...out.slice(0, limit), '…'] : out
}

export interface PluginInstallPlan {
  inspection: PluginInspection
  approved: PluginPermission[]
}

/**
 * Checks a plugin folder a plugin asked to install and asks the user, with the
 * same information as the install dialog in Settings. Resolves with what to
 * install, or null if they declined.
 */
export async function confirmPluginInstall(
  requester: Requester & { dataDir: string; mayReadAnywhere: boolean },
  p: Record<string, unknown>,
  installed: { id: string; name: string; version: string; linked: boolean } | undefined
): Promise<PluginInstallPlan | null> {
  const folder = resolve(String(p.path ?? ''))
  const rel = relative(requester.dataDir, folder)
  const inside = rel !== '' && !rel.startsWith('..') && !/^[a-zA-Z]:/.test(rel)
  if (!inside && !requester.mayReadAnywhere) {
    throw new Error(`${requester.name} can only install plugins from its own data folder`)
  }
  if (!existsSync(join(folder, 'plugin.json'))) throw new Error(`No plugin.json in ${folder}`)

  const inspection = await inspectPlugin(folder, 'folder')
  if (inspection.id === requester.id) throw new Error('A plugin cannot replace itself')
  if (installed?.linked) throw new Error(`"${installed.name}" is linked for development; it can't be replaced`)

  const fields: UiNode[] = []
  if (inspection.description) fields.push(node('Text', { text: inspection.description }))
  if (installed) {
    fields.push(
      node('Callout', {
        tone: 'warning',
        title: 'Replaces an installed plugin',
        text: `This replaces “${installed.name}” ${installed.version} (its saved data is kept).`
      })
    )
  }
  if (inspection.hasRequirements) {
    fields.push(node('Text', { text: 'Installs the Python packages listed in requirements.txt.', tone: 'muted', size: 'xs' }))
  }
  if (inspection.permissions.length) {
    fields.push(node('Heading', { text: 'It asks for', level: 3 }))
    for (const perm of inspection.permissions) {
      fields.push(
        node('Checkbox', {
          name: `perm:${perm.id}`,
          label: perm.risk === 'high' ? `${perm.label} (high risk)` : perm.label,
          description: perm.description,
          default: true
        })
      )
    }
  } else {
    fields.push(node('Text', { text: 'It asks for no permissions.', tone: 'muted' }))
  }
  fields.push(node('Text', { text: `Files in ${folder}:\n${listFiles(folder).join('\n')}`, tone: 'muted', size: 'xs' }))

  const reason = p.reason ? String(p.reason).slice(0, 600) : ''
  const verb = installed ? 'Update' : 'Install'
  const answer = (await appDialog(requester, {
    kind: 'form',
    title: `${verb} the plugin “${inspection.name}”?`,
    message: `${requester.name} wants to ${verb.toLowerCase()} ${inspection.name} ${inspection.version}${reason ? `: ${reason}` : '.'}`,
    fields,
    confirmLabel: verb,
    cancelLabel: 'Cancel'
  })) as Record<string, unknown> | null
  if (!answer) return null
  const approved = inspection.permissions.map((perm) => perm.id).filter((id) => answer[`perm:${id}`] !== false && isPermission(id))
  return { inspection, approved }
}

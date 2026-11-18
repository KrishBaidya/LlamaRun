import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve, sep } from 'node:path'
import type { BundleInfo, BundlePreview, HookConfig, HookEvent, McpServerConfig } from '@shared/types'
import { agentRoots } from '../assistant/agents'
import { HOOK_EVENTS, loadHooks, saveHooks, validateHooks } from '../assistant/hooks'
import { readJson, writeJson } from '../jsonFile'
import { configFromDirectoryEntry } from '../mcp/config'
import { userDataPath } from '../paths'
import { parseFrontMatter } from '../skills/frontMatter'
import { fetchSource, findSkillFolders, installSkills } from '../skills/install'
import { resolveSource } from '../skills/source'
import { skillsDir, skillStore } from '../skills/store'

/**
 * Claude Code plugins (the format OpenCode and DeepSeek's harness read too):
 * a folder or repository with .claude-plugin/plugin.json and any of skills/,
 * commands/, agents/, hooks/hooks.json and .mcp.json. Each part becomes its
 * Llama Run counterpart: skills as skills, commands as /command skills,
 * agents as agents, hooks merged into hooks.json and MCP servers added, with
 * ${CLAUDE_PLUGIN_ROOT} pointing at the plugin's copy in userData/bundles.
 * Hooks and MCP servers run code, so it's shown in full before installing.
 */

const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv'])
const bundlesDir = (): string => userDataPath('bundles')
const indexPath = (): string => join(bundlesDir(), 'installed.json')

interface Staged {
  dir: string
  tmp: string
  preview: BundlePreview
}
/** Inspected bundles waiting for the user's yes, by token. */
const staged = new Map<string, Staged>()

const safeName = (name: string): string => name.toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin'

/** The plugin's root: where .claude-plugin/plugin.json is (the folder itself, or one level down). */
export function findBundleRoot(base: string): string | null {
  const looks = (d: string): boolean =>
    existsSync(join(d, '.claude-plugin', 'plugin.json')) || ['commands', 'agents', 'hooks', '.mcp.json'].some((p) => existsSync(join(d, p)))
  if (looks(base)) return base
  for (const entry of readdirSync(base, { withFileTypes: true })) if (entry.isDirectory() && looks(join(base, entry.name))) return join(base, entry.name)
  return null
}

const mdFiles = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.md') : [])

/** Replaces ${CLAUDE_PLUGIN_ROOT} (Claude Code's variable for the plugin folder) with where the plugin will live. */
export const withRoot = (text: string, root: string): string => text.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, root.replace(/\\/g, '/'))

/** What a plugin folder holds, as the install card shows it. `root` is where it will be installed. */
export function describeBundle(dir: string, root: string): BundlePreview {
  const manifest = readJson<{ name?: string; description?: string; version?: string }>(join(dir, '.claude-plugin', 'plugin.json'), {})
  const name = manifest.name?.trim() || basename(dir)
  const skills = existsSync(join(dir, 'skills')) ? findSkillFolders(join(dir, 'skills')).map((f) => basename(f)) : []
  const commands = mdFiles(join(dir, 'commands')).map((f) => basename(f, '.md'))
  const agents = mdFiles(join(dir, 'agents')).map((f) => basename(f, '.md'))
  let hooks: HookConfig = {}
  const hooksFile = join(dir, 'hooks', 'hooks.json')
  if (existsSync(hooksFile)) {
    try {
      hooks = validateHooks(JSON.parse(withRoot(readFileSync(hooksFile, 'utf8'), root)))
    } catch {
      // Events Llama Run doesn't run (Notification, PreCompact…) are left out rather than refusing the plugin.
      const raw = (readJson<{ hooks?: Record<string, unknown> }>(hooksFile, {}).hooks ?? {}) as Record<string, unknown>
      const known = Object.fromEntries(Object.entries(raw).filter(([e]) => HOOK_EVENTS.includes(e as HookEvent)))
      try {
        hooks = validateHooks(JSON.parse(withRoot(JSON.stringify(known), root)))
      } catch {
        hooks = {}
      }
    }
  }
  const mcpRaw = readJson<{ mcpServers?: Record<string, unknown> }>(join(dir, '.mcp.json'), {}).mcpServers ?? {}
  const mcpServers: McpServerConfig[] = Object.entries(mcpRaw).map(([server, cfg]) =>
    configFromDirectoryEntry(`${name}:${server}`, JSON.parse(withRoot(JSON.stringify(cfg), root)))
  )
  const hookCommands = Object.entries(hooks).flatMap(([event, groups]) => (groups ?? []).flatMap((g) => g.hooks.map((h) => `${event}${g.matcher ? ` (${g.matcher})` : ''}: ${h.command}`)))
  return {
    name,
    description: manifest.description ?? '',
    ...(manifest.version ? { version: manifest.version } : {}),
    skills,
    commands,
    agents,
    hooks: hookCommands,
    mcpServers: mcpServers.map((s) => `${s.name}: ${s.data.Command ? [s.data.Command, ...(s.data.Arguments ?? [])].join(' ') : (s.data.URL ?? '')}`)
  }
}

/** Downloads or reads the plugin and says what it would add; nothing is installed yet. */
export async function inspectBundle(input: string): Promise<{ token: string; preview: BundlePreview }> {
  const source = resolveSource(input, {
    isDir: (p) => existsSync(p) && statSync(p).isDirectory(),
    isFile: (p) => existsSync(p) && statSync(p).isFile()
  })
  const tmp = mkdtempSync(join(tmpdir(), 'llamarun-bundle-'))
  try {
    const base = resolve(await fetchSource(source, tmp))
    const dir = existsSync(base) ? findBundleRoot(base) : null
    if (!dir) throw new Error("That isn't a Claude Code plugin: no .claude-plugin/plugin.json, commands, agents, hooks or .mcp.json there.")
    const firstName = readJson<{ name?: string }>(join(dir, '.claude-plugin', 'plugin.json'), {}).name?.trim() || basename(dir)
    const preview = describeBundle(dir, join(bundlesDir(), safeName(firstName)))
    if (![preview.skills, preview.commands, preview.agents, preview.hooks, preview.mcpServers].some((l) => l.length)) throw new Error('The plugin has nothing Llama Run can use.')
    const token = randomUUID()
    staged.set(token, { dir, tmp, preview })
    return { token, preview }
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true })
    throw err
  }
}

export function cancelBundle(token: string): void {
  const s = staged.get(token)
  if (s) rmSync(s.tmp, { recursive: true, force: true })
  staged.delete(token)
}

/** A command file as a skill run only by its /command (Claude Code's $ARGUMENTS work the same). */
function commandSkill(file: string, plugin: string, root: string): { id: string; text: string } {
  const { data, body } = parseFrontMatter(withRoot(readFileSync(file, 'utf8'), root))
  const name = basename(file, '.md')
  const description = (data.description || `/${name} from the ${plugin} plugin`).replace(/\s+/g, ' ').trim()
  const lines = ['---', `name: ${name}`, `description: ${JSON.stringify(description)}`, 'disable-model-invocation: true', ...(data['argument-hint'] ? [`argument-hint: ${JSON.stringify(data['argument-hint'])}`] : []), '---', '', body.trim(), '']
  return { id: `${safeName(plugin)}-cmd-${safeName(name)}`, text: lines.join('\n') }
}

export interface BundleDeps {
  addMcpServer: (server: McpServerConfig) => Promise<void>
  removeMcpServer: (name: string) => Promise<void>
}

/** Installs a plugin the user saw with inspectBundle. */
export async function installBundle(token: string, deps: BundleDeps): Promise<BundleInfo> {
  const s = staged.get(token)
  if (!s) throw new Error('That plugin is no longer waiting to be installed. Inspect it again.')
  staged.delete(token)
  try {
    const name = s.preview.name
    const root = join(bundlesDir(), safeName(name))
    if (!resolve(root).startsWith(resolve(bundlesDir()) + sep)) throw new Error('Bad plugin name')
    // A reinstall replaces the old copy and what it added.
    if (listBundles().some((b) => b.name === name)) await removeBundle(name, deps)
    rmSync(root, { recursive: true, force: true })
    mkdirSync(bundlesDir(), { recursive: true })
    cpSync(s.dir, root, { recursive: true, filter: (p) => !SKIP.has(basename(p)) })

    const info: BundleInfo = { name, description: s.preview.description, root, installedAt: Date.now(), skills: [], agents: [], mcpServers: [] }
    if (existsSync(join(root, 'skills'))) info.skills.push(...(await installSkills(join(root, 'skills'))).map((sk) => sk.id))
    mkdirSync(skillsDir(), { recursive: true })
    for (const f of mdFiles(join(root, 'commands'))) {
      const skill = commandSkill(join(root, 'commands', f), name, root)
      const dest = join(skillsDir(), skill.id)
      mkdirSync(dest, { recursive: true })
      writeFileSync(join(dest, 'SKILL.md'), skill.text, 'utf8')
      info.skills.push(skill.id)
    }
    skillStore.changed()
    const agentsDir = agentRoots()[0].dir
    mkdirSync(agentsDir, { recursive: true })
    for (const f of mdFiles(join(root, 'agents'))) {
      const file = `${safeName(name)}-${f}`
      writeFileSync(join(agentsDir, file), withRoot(readFileSync(join(root, 'agents', f), 'utf8'), root), 'utf8')
      info.agents.push(file)
    }
    const hooksFile = join(root, 'hooks', 'hooks.json')
    if (existsSync(hooksFile)) {
      const theirs = describeHooks(hooksFile, root)
      const mine = loadHooks()
      for (const [event, groups] of Object.entries(theirs) as [HookEvent, NonNullable<HookConfig[HookEvent]>][]) mine[event] = [...(mine[event] ?? []), ...groups]
      saveHooks(mine)
    }
    const mcpRaw = readJson<{ mcpServers?: Record<string, unknown> }>(join(root, '.mcp.json'), {}).mcpServers ?? {}
    for (const [server, cfg] of Object.entries(mcpRaw)) {
      const config = configFromDirectoryEntry(`${name}:${server}`, JSON.parse(withRoot(JSON.stringify(cfg), root)))
      await deps.addMcpServer(config)
      info.mcpServers.push(config.name)
    }
    writeJson(indexPath(), [...listBundles().filter((b) => b.name !== name), info])
    return info
  } finally {
    rmSync(s.tmp, { recursive: true, force: true })
  }
}

function describeHooks(file: string, root: string): HookConfig {
  const raw = (readJson<{ hooks?: Record<string, unknown> }>(file, {}).hooks ?? {}) as Record<string, unknown>
  const known = Object.fromEntries(Object.entries(raw).filter(([e]) => HOOK_EVENTS.includes(e as HookEvent)))
  return validateHooks(JSON.parse(withRoot(JSON.stringify(known), root)))
}

export function listBundles(): BundleInfo[] {
  return readJson<BundleInfo[]>(indexPath(), [])
}

/** Removes a plugin and everything it added: its skills, agents, hooks (those pointing into its folder) and MCP servers. */
export async function removeBundle(name: string, deps: BundleDeps): Promise<void> {
  const info = listBundles().find((b) => b.name === name)
  if (!info) return
  for (const id of info.skills) rmSync(join(skillsDir(), id), { recursive: true, force: true })
  skillStore.changed()
  const agentsDir = agentRoots()[0].dir
  for (const f of info.agents) rmSync(join(agentsDir, f), { force: true })
  const root = info.root.replace(/\\/g, '/')
  const hooks = loadHooks()
  for (const event of Object.keys(hooks) as HookEvent[]) {
    hooks[event] = (hooks[event] ?? []).filter((g) => !g.hooks.some((h) => h.command.includes(root) || h.command.includes(info.root)))
    if (!hooks[event]?.length) delete hooks[event]
  }
  saveHooks(hooks)
  for (const server of info.mcpServers) await deps.removeMcpServer(server).catch(() => {})
  rmSync(info.root, { recursive: true, force: true })
  writeJson(indexPath(), listBundles().filter((b) => b.name !== name))
}

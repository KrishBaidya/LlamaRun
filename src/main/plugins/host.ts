import { EventEmitter } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { app, globalShortcut, Notification, shell } from 'electron'
import type {
  ChatAttachment,
  ChatEvent,
  ChatMessage,
  McpToolInfo,
  PluginInfo,
  PluginPermission,
  PluginRuntimeStatus,
  PluginState,
  SlashCommand,
  UiNode
} from '@shared/types'
import { BUILTIN_COMMANDS, chatService } from '../chats/service'
import { memoryStore } from '../memory/store'
import { installSkills } from '../skills/install'
import { skillStore } from '../skills/store'
import { availableModelIds, generate } from '../llm'
import { mcp, type McpToolResult } from '../mcp/manager'
import { iconPath, logsDir, pluginDataDir, pluginsDir, pythonExecutable } from '../paths'
import { settings } from '../settings'
import { openChatWindow } from '../windows/chat'
import { Broker, type BrokerPeer } from './broker'
import { installPlugin, removePluginFolder } from './install'
import { confirmPluginInstall, directoryServer, listServers, requestMcpServer, searchDirectory } from './installRequests'
import { searchMarketplace } from './marketplace'
import { orderPlugins, readManifest, type PluginManifest } from './manifest'
import { allows, effectiveGrants } from './permissions'
import { PluginProcess, type LoadInfo } from './process'
import { closePluginDialogs, showPluginDialog } from './ui/dialogs'
import { hudHost } from './ui/hud'
import { closePanel, closePluginPanels, openPanel, reloadPluginPanels, renderPanel, setPanelState, setPanelTitle } from './ui/panels'
import { pluginSettings } from './ui/settingsForms'

export interface BeforeGenerationResult {
  input_text: string
  model: string
  cancel: boolean
  cancelled_by: string | null
}

export interface AfterGenerationResult {
  input_text: string
  response_text: string
  model: string
}

const HOOK_TIMEOUT_MS = 120_000
/** Tools can ask the user things (an install dialog, say), so they get longer than hooks. */
const TOOL_TIMEOUT_MS = 15 * 60_000
const MAX_RESTARTS = 5

interface PluginRecord {
  id: string
  folder: string
  linked: boolean
  manifest: PluginManifest | null
  /** Manifest or dependency problem: the plugin can't start. */
  problem?: string
  /** Last load or runtime error reported by the plugin. */
  error?: string
  process: PluginProcess | null
  load: LoadInfo | null
  starting: Promise<void> | null
  state: PluginState
  crashes: number[]
  restartTimer?: NodeJS.Timeout
  blocked: Set<PluginPermission>
  icon?: string
  watcher?: FSWatcher
  /** Global shortcuts the plugin registered: its id -> accelerator. */
  shortcuts?: Map<string, string>
  /** Text the plugin adds to every chat turn's instructions: its key -> text. */
  context?: Map<string, string>
  /** Slash commands it added to the chat box: name -> [description, args hint]. */
  commands?: Map<string, [string, string]>
  /** Theme CSS it applies to the app's windows. */
  css?: string
}

/** Command names: letters, digits, - and _, starting with a letter. */
const COMMAND_NAME = /^[a-z][a-z0-9_-]{0,31}$/
const MAX_CONTEXT_CHARS = 4000
const MAX_CSS_CHARS = 100_000
const COMMAND_TIMEOUT_MS = 5 * 60_000

/** Images (data: URLs) a plugin posts with a message. */
function postedImages(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 6).flatMap((v, i): ChatAttachment[] => {
    const src = typeof v === 'string' ? v : (v as { src?: unknown })?.src
    if (typeof src !== 'string') return []
    const m = /^data:(image\/[\w.+-]+);base64,/.exec(src)
    if (!m) return []
    return [{ id: `${Date.now()}-${i}`, kind: 'image', name: `image-${i + 1}`, mimeType: m[1], size: src.length, dataUrl: src }]
  })
}

const withoutFolder = <T extends { folder: string }>({ folder: _folder, ...rest }: T): Omit<T, 'folder'> => rest

/** What a plugin gets back for a chat turn it sent. */
function turnResult(chatId: string, m: ChatMessage): Record<string, unknown> {
  return {
    chat_id: chatId,
    message_id: m.id,
    text: m.content,
    status: m.status,
    error: m.error ?? null,
    model: m.model ?? null,
    tools: m.tools ?? [],
    paused: Boolean(m.toolLimit)
  }
}

class PermissionDenied extends Error {}

/**
 * Supervises plugins. Each one runs in its own bundled-Python process with
 * the permissions the user granted; the SDK's host calls (models, MCP, UI,
 * other plugins) come back here over JSON-RPC and are checked per plugin.
 */
class PluginHost extends EventEmitter<{
  changed: [PluginInfo[]]
  status: [PluginRuntimeStatus]
  commands: [SlashCommand[]]
  css: [string]
}> {
  private records = new Map<string, PluginRecord>()
  private order: string[] = []
  private ready: Promise<void> | null = null
  private runtime: PluginRuntimeStatus = { state: 'stopped', pythonPath: pythonExecutable() }
  private changedTimer: NodeJS.Timeout | null = null
  readonly broker = new Broker(() => this.peers())

  constructor() {
    super()
    hudHost.onClick = (pluginId, hudId, event) => {
      void this.records.get(pluginId)?.process?.request('ui.event', { id: hudId, event }).catch(() => {})
    }
  }

  get status(): PluginRuntimeStatus {
    return this.runtime
  }

  get list(): PluginInfo[] {
    return this.order.map((id) => this.info(this.records.get(id)!))
  }

  // ---------------------------------------------------------------- lifecycle

  start(): Promise<void> {
    this.ready ??= this.boot()
    return this.ready
  }

  private async boot(): Promise<void> {
    const python = pythonExecutable()
    if (!existsSync(python)) {
      this.setStatus({ state: 'unavailable', pythonPath: python, error: `Bundled Python not found at ${python}. Run "npm run fetch-python".` })
      this.discover()
      return
    }
    this.setStatus({ state: 'running', pythonPath: python, error: undefined })
    this.discover()
    await Promise.allSettled(this.order.map((id) => this.startPlugin(this.records.get(id)!)))
  }

  async stop(): Promise<void> {
    await Promise.allSettled([...this.records.values()].map((r) => this.stopPlugin(r)))
    for (const r of this.records.values()) r.watcher?.close()
    hudHost.close()
    this.setStatus({ state: 'stopped' })
  }

  /** Reads every plugin folder (and dev links) and computes the load order. */
  private discover(): void {
    mkdirSync(pluginsDir(), { recursive: true })
    const folders = new Map<string, { folder: string; linked: boolean }>()
    for (const name of readdirSync(pluginsDir())) {
      const folder = join(pluginsDir(), name)
      if (!name.startsWith('.') && statSync(folder).isDirectory()) folders.set(name, { folder, linked: false })
    }
    for (const [id, folder] of Object.entries(settings.get('pluginLinks'))) {
      if (existsSync(folder)) folders.set(id, { folder, linked: true })
    }

    for (const [id, record] of this.records) {
      if (!folders.has(id)) {
        void this.stopPlugin(record)
        record.watcher?.close()
        this.records.delete(id)
      }
    }
    for (const [id, { folder, linked }] of folders) {
      const existing = this.records.get(id)
      const record: PluginRecord = existing ?? {
        id,
        folder,
        linked,
        manifest: null,
        process: null,
        load: null,
        starting: null,
        state: 'stopped',
        crashes: [],
        blocked: new Set()
      }
      record.folder = folder
      record.linked = linked
      record.problem = undefined
      try {
        record.manifest = readManifest(folder)
      } catch (err) {
        record.manifest = null
        record.problem = (err as Error).message
      }
      const icon = join(folder, 'icon.png')
      record.icon = existsSync(icon) ? `data:image/png;base64,${readFileSync(icon).toString('base64')}` : undefined
      if (linked && !record.watcher) this.watchLinked(record)
      this.records.set(id, record)
    }

    const valid = [...this.records.values()].filter((r) => r.manifest)
    const seen = new Map<string, string>()
    for (const r of valid.sort((a, b) => a.id.localeCompare(b.id))) {
      const other = seen.get(r.manifest!.module)
      if (other) r.problem = `module "${r.manifest!.module}" is already used by plugin "${other}"`
      else seen.set(r.manifest!.module, r.id)
    }
    const candidates = valid.filter((r) => !r.problem)
    const versions = Object.fromEntries(candidates.map((r) => [r.manifest!.module, r.manifest!.version]))
    const { order, problems } = orderPlugins(
      candidates.map((r) => ({ id: r.id, module: r.manifest!.module, dependencies: r.manifest!.dependencies })),
      versions
    )
    for (const [id, problem] of problems) this.records.get(id)!.problem = problem
    const rest = [...this.records.values()].filter((r) => !order.some((o) => o.id === r.id)).map((r) => r.id).sort()
    this.order = [...order.map((o) => o.id), ...rest]
    this.emitChanged()
  }

  private grantsOf(record: PluginRecord): PluginPermission[] | null {
    const granted = settings.get('pluginGrants')[record.id]
    if (!granted || !record.manifest) return null
    return effectiveGrants(record.manifest.permissions, granted)
  }

  private enabled(record: PluginRecord): boolean {
    return settings.get('pluginsEnabled')[record.id] !== false
  }

  private startPlugin(record: PluginRecord): Promise<void> {
    if (record.starting) return record.starting
    if (record.process?.running) return Promise.resolve()
    const run = async (): Promise<void> => {
      if (!record.manifest || record.problem) {
        record.state = 'error'
        return
      }
      if (!this.enabled(record)) {
        record.state = 'disabled'
        return
      }
      const grants = this.grantsOf(record)
      if (!grants) {
        record.state = 'needs-consent'
        return
      }
      if (this.runtime.state === 'unavailable') {
        record.state = 'error'
        record.error = this.runtime.error
        return
      }
      const manifest = record.manifest
      record.state = 'starting'
      record.error = undefined
      record.blocked.clear()
      this.emitChanged()
      const proc = new PluginProcess({
        id: record.id,
        name: manifest.name,
        folder: record.folder,
        dataDir: join(pluginDataDir(), manifest.module),
        grants,
        debug: !app.isPackaged,
        handlers: this.hostApi(record, grants),
        onNotification: (method, params) => this.onNotification(record, method, params),
        log: (level, message) => this.log(level, message, manifest.name)
      })
      record.process = proc
      proc.on('exit', (code) => this.onCrash(record, code))
      try {
        const info = await proc.start()
        record.load = info
        record.error = info.error ?? undefined
        record.state = info.loaded ? 'running' : 'error'
        this.setStatus({ pythonVersion: info.pythonVersion })
      } catch (err) {
        record.error = (err as Error).message
        record.state = 'error'
        record.process = null
      }
    }
    record.starting = run().finally(() => {
      record.starting = null
      this.emitChanged()
    })
    return record.starting
  }

  private async stopPlugin(record: PluginRecord): Promise<void> {
    clearTimeout(record.restartTimer)
    await record.starting?.catch(() => {})
    const proc = record.process
    record.process = null
    record.load = null
    this.cleanupSurfaces(record)
    if (proc) await proc.stop()
    record.state = 'stopped'
  }

  private async restartPlugin(record: PluginRecord): Promise<void> {
    await this.stopPlugin(record)
    record.crashes = []
    await this.startPlugin(record)
  }

  private cleanupSurfaces(record: PluginRecord): void {
    hudHost.removePlugin(record.id)
    closePluginPanels(record.id)
    closePluginDialogs(record.id)
    pluginSettings.forget(record.id)
    this.broker.forget(record.id)
    for (const accelerator of record.shortcuts?.values() ?? []) globalShortcut.unregister(accelerator)
    record.shortcuts?.clear()
    record.context?.clear()
    if (record.commands?.size) {
      record.commands.clear()
      this.emit('commands', this.commands())
    }
    if (record.css) {
      record.css = undefined
      this.emit('css', this.css())
    }
  }

  // ------------------------------------------------- chat context, commands, theme

  /** What running plugins add to every turn's instructions. */
  contextText(): string {
    const blocks: string[] = []
    for (const id of this.order) {
      const r = this.records.get(id)!
      const texts = [...(r.context?.values() ?? [])].filter(Boolean)
      if (r.process && texts.length) blocks.push(`## From the ${r.manifest?.name ?? id} plugin\n${texts.join('\n')}`)
    }
    return blocks.join('\n\n')
  }

  /** Slash commands running plugins added. */
  commands(): SlashCommand[] {
    return this.order.flatMap((id) => {
      const r = this.records.get(id)!
      if (!r.process) return []
      return [...(r.commands?.entries() ?? [])].map(([name, [description, args]]) => ({
        name,
        description,
        plugin: r.manifest?.name ?? id,
        ...(args ? { args } : {})
      }))
    })
  }

  /** The plugin that registered the command typed at the start of `text`, if any. */
  matchCommand(text: string): { plugin: string; name: string } | null {
    const m = /^\/([a-z][a-z0-9_-]*)(?:\s|$)/i.exec(text.trim())
    if (!m) return null
    const name = m[1].toLowerCase()
    for (const id of this.order) {
      const r = this.records.get(id)!
      if (r.process && r.commands?.has(name)) return { plugin: id, name }
    }
    return null
  }

  async runCommand(pluginId: string, name: string, args: string, chatId: string): Promise<string | null> {
    const proc = this.records.get(pluginId)?.process
    if (!proc) throw new Error('The plugin is not running')
    const reply = await proc.request('commands.run', { name, args, chat_id: chatId }, COMMAND_TIMEOUT_MS)
    return typeof reply === 'string' && reply.trim() ? reply : null
  }

  pluginName(id: string): string {
    return this.records.get(id)?.manifest?.name ?? id
  }

  /** Theme CSS from every running plugin, in load order. */
  css(): string {
    return this.order
      .map((id) => this.records.get(id)!)
      .filter((r) => r.css && r.process)
      .map((r) => `/* ${r.manifest?.name} */\n${r.css}`)
      .join('\n')
  }

  /**
   * Streams a chat turn a plugin started back to it as `chats.stream`
   * notifications (numbered, since the plugin handles them on a thread pool),
   * and resolves with the finished reply.
   */
  private async followTurn(record: PluginRecord, chatId: string, stream: string, done: Promise<ChatMessage>): Promise<unknown> {
    let seq = 0
    const send = (params: Record<string, unknown>): void => {
      if (stream) record.process?.notify('chats.stream', { stream, seq: seq++, ...params })
    }
    const forward = (e: ChatEvent): void => {
      if (e.type === 'delta' && e.chatId === chatId) send({ type: 'token', text: e.text })
      else if (e.type === 'tool' && e.chatId === chatId) send({ type: 'tool', name: e.tool.name, server: e.tool.server })
    }
    chatService.on('event', forward)
    send({ type: 'start', chat_id: chatId })
    try {
      return turnResult(chatId, await done)
    } finally {
      chatService.off('event', forward)
    }
  }

  private onCrash(record: PluginRecord, code: number | null): void {
    record.process = null
    record.load = null
    this.cleanupSurfaces(record)
    const now = Date.now()
    record.crashes = record.crashes.filter((t) => now - t < 60_000).concat(now)
    this.log('error', `plugin process exited unexpectedly (code ${code})`, record.manifest?.name ?? record.id)
    if (record.crashes.length > MAX_RESTARTS) {
      record.state = 'error'
      record.error = 'Keeps crashing. Reload the plugin to try again.'
      this.emitChanged()
      return
    }
    record.state = 'crashed'
    record.error = `Restarting after a crash (exit code ${code})`
    this.emitChanged()
    const delay = Math.min(30_000, 1000 * 2 ** (record.crashes.length - 1))
    record.restartTimer = setTimeout(() => void this.startPlugin(record), delay)
  }

  /** Dev-linked plugins restart when their Python changes and reload panels when their TSX changes. */
  private watchLinked(record: PluginRecord): void {
    let timer: NodeJS.Timeout | null = null
    let python = false
    try {
      record.watcher = watch(record.folder, { recursive: true }, (_event, file) => {
        const name = String(file ?? '')
        if (!name || /(^|[\\/])(\.deps|__pycache__|\.git|node_modules)([\\/]|$)/.test(name)) return
        if (!/\.(tsx?|jsx?|css)$/.test(name)) python = true
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          const restart = python
          python = false
          this.log('info', `source changed (${name}); ${restart ? 'restarting' : 'reloading panels'}`, record.manifest?.name ?? record.id)
          if (restart) void this.reload(record.id)
          else if (record.manifest) void reloadPluginPanels(record.id, this.panelPlugin(record))
        }, 300)
      })
    } catch (err) {
      this.log('warning', `can't watch ${record.folder}: ${(err as Error).message}`)
    }
  }

  // ------------------------------------------------------------ public API

  async reload(id?: string): Promise<PluginInfo[]> {
    await this.start()
    if (id) {
      const record = this.records.get(id)
      if (!record) throw new Error(`Unknown plugin: ${id}`)
      await this.stopPlugin(record)
      this.discover()
      const fresh = this.records.get(id)
      if (fresh) {
        fresh.crashes = []
        await this.startPlugin(fresh)
      }
    } else {
      await Promise.allSettled([...this.records.values()].map((r) => this.stopPlugin(r)))
      this.discover()
      await Promise.allSettled(this.order.map((i) => this.startPlugin(this.records.get(i)!)))
    }
    return this.list
  }

  /** Picks up a plugin folder that appeared after startup (a bundled plugin that finished setting up). */
  async adopt(id: string): Promise<void> {
    await this.start()
    this.discover()
    const record = this.records.get(id)
    if (record) await this.startPlugin(record)
  }

  async setEnabled(id: string, enabled: boolean): Promise<PluginInfo[]> {
    settings.set({ pluginsEnabled: { ...settings.get('pluginsEnabled'), [id]: enabled } })
    await this.start()
    const record = this.records.get(id)
    if (record) {
      if (enabled) {
        record.crashes = []
        await this.startPlugin(record)
      } else {
        await this.stopPlugin(record)
        record.state = 'disabled'
      }
    }
    this.emitChanged()
    return this.list
  }

  /** Store the permissions the user approved (a subset of what the plugin asks for) and restart it. */
  async setGrants(id: string, grants: PluginPermission[]): Promise<PluginInfo[]> {
    const record = this.records.get(id)
    if (!record?.manifest) throw new Error(`Unknown plugin: ${id}`)
    const allowed = effectiveGrants(record.manifest.permissions, grants)
    settings.set({ pluginGrants: { ...settings.get('pluginGrants'), [id]: allowed } })
    await this.restartPlugin(record)
    return this.list
  }

  /** Unloads, deletes the folder (or just the link, for dev plugins) and forgets the grants. */
  async remove(id: string): Promise<PluginInfo[]> {
    const record = this.records.get(id)
    if (record) {
      await this.stopPlugin(record)
      record.watcher?.close()
    }
    if (record?.linked) {
      const links = { ...settings.get('pluginLinks') }
      delete links[id]
      settings.set({ pluginLinks: links })
    } else {
      removePluginFolder(id)
    }
    const enabled = { ...settings.get('pluginsEnabled') }
    const grants = { ...settings.get('pluginGrants') }
    delete enabled[id]
    delete grants[id]
    settings.set({ pluginsEnabled: enabled, pluginGrants: grants })
    this.records.delete(id)
    return this.reload()
  }

  async runAction(id: string, action: string): Promise<void> {
    const record = this.records.get(id)
    if (!record?.process?.running) throw new Error(`${record?.manifest?.name ?? id} isn't running`)
    await record.process.request('events.custom', { action })
  }

  manifestOf(id: string): PluginManifest | null {
    return this.records.get(id)?.manifest ?? null
  }

  folderOf(id: string): string | null {
    return this.records.get(id)?.folder ?? null
  }

  settingsView(id: string) {
    const record = this.records.get(id)
    if (!record?.manifest) throw new Error(`Unknown plugin: ${id}`)
    return pluginSettings.view(id, record.manifest.module)
  }

  async saveSettings(id: string, values: Record<string, unknown>) {
    const record = this.records.get(id)
    if (!record?.manifest) throw new Error(`Unknown plugin: ${id}`)
    const changed = pluginSettings.save(id, record.manifest.module, values)
    if (Object.keys(changed).length && record.process?.running) {
      await record.process.request('settings.changed', { values: changed }, 30_000).catch((err) => {
        this.log('warning', `settings.changed: ${(err as Error).message}`, record.manifest!.name)
      })
    }
    return pluginSettings.view(id, record.manifest.module)
  }

  /** Lets plugins subscribed to app.<topic> know something happened in the app. */
  publishAppEvent(topic: string, data: unknown): void {
    this.broker.publish('app', topic, data)
  }

  // ------------------------------------------------------------- model tools

  /**
   * Tools that running plugins with the "tools" permission offer to models,
   * named as the plugin declared them. A name already in `taken` (an MCP tool,
   * or an earlier plugin's) is skipped, so a plugin can't shadow another tool.
   */
  modelTools(taken: Set<string> = new Set()): McpToolInfo[] {
    const tools: McpToolInfo[] = []
    const names = new Set(taken)
    for (const record of this.toolProviders()) {
      for (const spec of record.load!.tools) {
        if (names.has(spec.name)) {
          this.warnOnce(record, `tool "${spec.name}" is hidden: another tool already has that name`)
          continue
        }
        names.add(spec.name)
        tools.push({ name: spec.name, description: spec.description, server: record.manifest!.name, inputSchema: spec.inputSchema })
      }
    }
    return tools
  }

  /** Runs a tool from `modelTools()` in the plugin that offers it. */
  async callModelTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const record = this.toolProviders().find((r) => r.load!.tools.some((t) => t.name === name))
    if (!record) throw new Error(`Tool not found: ${name}`)
    const result = await record.process!.request<McpToolResult>('tools.call', { name, arguments: args }, TOOL_TIMEOUT_MS)
    return { content: Array.isArray(result?.content) ? result.content : [], isError: Boolean(result?.isError) }
  }

  private toolProviders(): PluginRecord[] {
    return this.order
      .map((id) => this.records.get(id)!)
      .filter((r) => r.process?.running && r.load?.tools?.length && allows(this.grantsOf(r) ?? [], 'tools'))
  }

  private warned = new Set<string>()
  private warnOnce(record: PluginRecord, message: string): void {
    const key = `${record.id}:${message}`
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.log('warning', message, record.manifest?.name)
  }

  /**
   * Installs a plugin another plugin made, after the user agreed, and starts
   * just that plugin: reloading everything would also restart the one asking.
   */
  private async installFor(requester: PluginRecord, grants: PluginPermission[], p: Record<string, unknown>): Promise<unknown> {
    const manifest = requester.manifest!
    const id = String(p.path ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
    const existing = this.records.get(id)
    const plan = await confirmPluginInstall(
      { id: requester.id, name: manifest.name, dataDir: resolve(pluginDataDir(), manifest.module), mayReadAnywhere: allows(grants, 'filesystem') },
      p,
      existing?.manifest ? { id, name: existing.manifest.name, version: existing.manifest.version, linked: existing.linked } : undefined
    )
    if (!plan) return null
    const target = this.records.get(plan.inspection.id)
    if (target) await this.stopPlugin(target)
    const installedId = await installPlugin(plan.inspection.source, 'folder', plan.approved)
    this.log('info', `installed plugin ${installedId} for ${manifest.name} with permissions: ${plan.approved.join(', ') || 'none'}`)
    this.discover()
    const record = this.records.get(installedId)
    if (!record) throw new Error('The plugin was installed but could not be found')
    record.crashes = []
    await this.startPlugin(record)
    return this.summary(record)
  }

  /** What a plugin with the "install" permission learns about another plugin. */
  private summary(r: PluginRecord): Record<string, unknown> {
    const info = this.info(r)
    return {
      id: info.id,
      name: info.name,
      description: info.description,
      version: info.version,
      module: info.module,
      state: info.state,
      error: info.error ?? null,
      tools: info.tools,
      granted: info.granted
    }
  }

  // ------------------------------------------------------------------- hooks

  private hookTargets(hook: 'before_text_generation' | 'after_text_generation'): PluginRecord[] {
    return this.order
      .map((id) => this.records.get(id)!)
      .filter((r) => r.process?.running && r.load?.hooks.includes(hook) && allows(this.grantsOf(r) ?? [], 'hooks'))
  }

  private async hookFailed(record: PluginRecord, hook: string, err: unknown): Promise<void> {
    const message = (err as Error).message
    this.log('error', `${hook}: ${message}`, record.manifest?.name)
    if (/timed out/.test(message) && record.process) {
      // A plugin that doesn't even answer ping is stuck: restart it.
      try {
        await record.process.request('ping', {}, 5000)
      } catch {
        this.log('error', 'not responding; restarting', record.manifest?.name)
        record.process.kill()
      }
    }
  }

  async beforeTextGeneration(inputText: string, model: string): Promise<BeforeGenerationResult> {
    let ctx = { input_text: inputText, model, cancel: false }
    for (const record of this.hookTargets('before_text_generation')) {
      try {
        const out = await record.process!.request<typeof ctx | null>(
          'events.before_text_generation',
          { input_text: ctx.input_text, model: ctx.model },
          HOOK_TIMEOUT_MS
        )
        if (!out) continue
        ctx = { input_text: String(out.input_text), model: String(out.model || ctx.model), cancel: !!out.cancel }
        if (ctx.cancel) return { ...ctx, cancelled_by: record.manifest!.name }
      } catch (err) {
        await this.hookFailed(record, 'before_text_generation', err)
      }
    }
    return { ...ctx, cancelled_by: null }
  }

  async afterTextGeneration(inputText: string, responseText: string, model: string): Promise<AfterGenerationResult> {
    let result = { input_text: inputText, response_text: responseText, model }
    for (const record of this.hookTargets('after_text_generation')) {
      try {
        const out = await record.process!.request<typeof result | null>('events.after_text_generation', result, HOOK_TIMEOUT_MS)
        if (out) result = { input_text: String(out.input_text), response_text: String(out.response_text), model: String(out.model) }
      } catch (err) {
        await this.hookFailed(record, 'after_text_generation', err)
      }
    }
    return result
  }

  // --------------------------------------------------------------- host API

  private peers(): BrokerPeer[] {
    return [...this.records.values()]
      .filter((r) => r.manifest)
      .map((r) => this.peerOf(r))
  }

  private peerOf(r: PluginRecord): BrokerPeer {
    return {
      id: r.id,
      module: r.manifest!.module,
      name: r.manifest!.name,
      dependencies: r.manifest!.dependencies,
      sharedWriters: r.manifest!.sharedWriters,
      process: r.process,
      services: r.load?.services ?? [],
      subscriptions: r.process?.info?.subscriptions ?? r.load?.subscriptions ?? []
    }
  }

  private panelPlugin(record: PluginRecord) {
    return { id: record.id, name: record.manifest!.name, folder: record.folder, panels: record.manifest!.panels }
  }

  /** Methods one plugin can call, bound to it and checked against its grants. */
  private hostApi(record: PluginRecord, grants: PluginPermission[]): Record<string, (p: Record<string, unknown>) => unknown> {
    const manifest = record.manifest!
    const need = (permission: PluginPermission): void => {
      if (!allows(grants, permission)) {
        throw new PermissionDenied(`${manifest.name} doesn't have the "${permission}" permission. Add it to "permissions" in plugin.json.`)
      }
    }
    const needAny = (...permissions: PluginPermission[]): void => {
      if (!permissions.some((p) => allows(grants, p))) need(permissions[0])
    }
    const dataDir = resolve(pluginDataDir(), manifest.module)
    const plugin = { id: record.id, name: manifest.name, icon: record.icon }
    return {
      'app.get_version': () => app.getVersion(),
      'app.notify': (p) => {
        if (Notification.isSupported()) {
          new Notification({ title: String(p.title), body: String(p.message), icon: iconPath() }).show()
        }
        return null
      },
      'app.open_url': (p) => {
        const url = String(p.url ?? '')
        if (!/^(https?:|mailto:)/i.test(url)) throw new Error('only http(s) and mailto links can be opened')
        void shell.openExternal(url)
        return null
      },
      'app.open_path': async (p) => {
        const target = resolve(String(p.path ?? ''))
        const rel = relative(dataDir, target)
        const insideData = !rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel)
        if (!insideData && !allows(grants, 'filesystem')) {
          throw new PermissionDenied(`${manifest.name} can only open files in its data folder without the "filesystem" permission`)
        }
        const error = await shell.openPath(target)
        if (error) throw new Error(error)
        return null
      },
      'llm.get_selected_model': () => (need('llm'), settings.get('selectedModel')),
      'llm.get_available_models': () => (need('llm'), availableModelIds()),
      // Headless and event-free: calling this from a hook never re-enters plugin hooks.
      'llm.generate': (p) => {
        need('llm')
        return generate(String(p.prompt ?? ''), { model: String(p.model || settings.get('selectedModel')) })
      },
      // A chat turn, exactly as if the user typed it: history, MCP tools (with the "mcp"
      // permission), plugin hooks and the tool-call limit. It appears in the chat window.
      'chats.send': (p) => {
        need('chats')
        const { chatId, done } = chatService.ask(p.chat_id ? String(p.chat_id) : null, String(p.text ?? ''), {
          model: p.model ? String(p.model) : undefined,
          via: { plugin: manifest.name, ...(p.voice === true ? { voice: true } : {}) },
          turn: {
            system: p.instructions ? String(p.instructions) : undefined,
            tools: p.tools !== false && allows(grants, 'mcp')
          },
          ephemeral: p.save === false
        })
        return this.followTurn(record, chatId, String(p.stream ?? ''), done)
      },
      'chats.continue': (p) => {
        need('chats')
        const chatId = String(p.chat_id ?? '')
        const done = chatService.continue(chatId)
        if (!done) throw new Error('That reply has nothing to continue')
        return this.followTurn(record, chatId, String(p.stream ?? ''), done)
      },
      'chats.cancel': (p) => (need('chats'), chatService.cancel(String(p.chat_id ?? '')), null),
      'chats.compact': async (p) => {
        need('chats')
        await chatService.compact(String(p.chat_id ?? ''), p.instructions ? String(p.instructions) : undefined)
        return null
      },
      // A message the plugin wrote itself (markdown, ```html previews, images), shown without asking a model.
      'chats.post': (p) => {
        needAny('commands', 'chats')
        const text = String(p.text ?? '')
        const images = postedImages(p.images)
        if (!text.trim() && !images.length) throw new Error('Nothing to post')
        const posted = chatService.post(p.chat_id ? String(p.chat_id) : null, text, manifest.name, images)
        if (p.open === true) openChatWindow(posted.chatId)
        return { chat_id: posted.chatId, message_id: posted.messageId }
      },
      'commands.register': (p) => {
        need('commands')
        const name = String(p.name ?? '').replace(/^\//, '').toLowerCase()
        if (!COMMAND_NAME.test(name)) throw new Error(`"${name}" is not a valid command name. Use letters, digits, - and _.`)
        if (BUILTIN_COMMANDS.some((c) => c.name === name)) throw new Error(`/${name} is built into Llama Run`)
        for (const other of this.records.values()) {
          if (other !== record && other.commands?.has(name)) throw new Error(`/${name} is already used by ${other.manifest?.name}`)
        }
        record.commands ??= new Map()
        record.commands.set(name, [String(p.description ?? '').slice(0, 200), String(p.args ?? '').slice(0, 60)])
        this.emit('commands', this.commands())
        return null
      },
      'commands.unregister': (p) => {
        if (record.commands?.delete(String(p.name ?? '').replace(/^\//, '').toLowerCase())) this.emit('commands', this.commands())
        return null
      },
      'context.set': (p) => {
        need('context')
        const text = String(p.text ?? '').trim()
        if (text.length > MAX_CONTEXT_CHARS) throw new Error(`Keep context under ${MAX_CONTEXT_CHARS} characters`)
        record.context ??= new Map()
        if (text) record.context.set(String(p.key ?? 'default'), text)
        else record.context.delete(String(p.key ?? 'default'))
        return null
      },
      'context.clear': (p) => {
        if (p.key === undefined || p.key === null) record.context?.clear()
        else record.context?.delete(String(p.key))
        return null
      },
      'memory.list': () => (need('memory'), memoryStore.list()),
      'memory.add': (p) => (need('memory'), memoryStore.add(String(p.text ?? ''), manifest.name)),
      'memory.update': (p) => (need('memory'), memoryStore.update(String(p.id ?? ''), String(p.text ?? ''), manifest.name)),
      'memory.delete': (p) => (need('memory'), memoryStore.remove(String(p.id ?? ''))),
      'skills.list': () => (need('skills'), skillStore.list().map(withoutFolder)),
      'skills.install': async (p) => {
        need('skills')
        const source = String(p.source ?? p.url ?? '')
        const ok = await showPluginDialog(plugin, {
          kind: 'confirm',
          title: 'Install skills?',
          message: `${manifest.name} wants to install skills from ${source}. Skills can run Python scripts on your computer when your models use them (you are asked first).`,
          confirmLabel: 'Install'
        })
        if (ok !== true) throw new Error('The user declined')
        return (await installSkills(source)).map(withoutFolder)
      },
      'appearance.set_css': (p) => {
        need('appearance')
        const css = String(p.css ?? '')
        if (css.length > MAX_CSS_CHARS) throw new Error('That stylesheet is too large')
        record.css = css.trim() || undefined
        this.emit('css', this.css())
        return null
      },
      'chats.list': () => (need('chats'), chatService.list()),
      'chats.get': (p) => (need('chats'), chatService.get(String(p.chat_id ?? ''))),
      'chats.open': (p) => {
        need('chats')
        const chat = chatService.get(String(p.chat_id ?? ''))
        if (!chat || chat.ephemeral) throw new Error('That chat is not saved, so it cannot be opened')
        openChatWindow(chat.id)
        return null
      },
      'app.shortcut.register': (p) => {
        const id = String(p.id ?? '')
        const accelerator = String(p.accelerator ?? '').trim()
        record.shortcuts ??= new Map()
        const previous = record.shortcuts.get(id)
        if (previous) globalShortcut.unregister(previous)
        record.shortcuts.delete(id)
        let taken: boolean
        let ok = false
        try {
          taken = globalShortcut.isRegistered(accelerator)
          if (!taken) ok = globalShortcut.register(accelerator, () => record.process?.notify('app.shortcut', { id }))
        } catch {
          throw new Error(`"${accelerator}" is not a valid shortcut. Use a form like "Ctrl+Alt+E".`)
        }
        if (taken) throw new Error(`${accelerator} is already used by Llama Run or another plugin`)
        if (!ok) throw new Error(`${accelerator} is already used by another app`)
        record.shortcuts.set(id, accelerator)
        return null
      },
      'app.shortcut.unregister': (p) => {
        const accelerator = record.shortcuts?.get(String(p.id ?? ''))
        if (accelerator) globalShortcut.unregister(accelerator)
        record.shortcuts?.delete(String(p.id ?? ''))
        return null
      },
      'mcp.list_tools': () => (need('mcp'), mcp.tools()),
      'mcp.call_tool': (p) => {
        need('mcp')
        return mcp.callTool(String(p.name), (p.arguments as Record<string, unknown>) ?? {})
      },
      // Browsing and installing: the app asks the user before anything is added.
      'mcp.directory.search': (p) => (needAny('install', 'mcp'), searchDirectory(p)),
      'mcp.directory.get': (p) => (needAny('install', 'mcp'), directoryServer(p)),
      'mcp.list_servers': () => (needAny('install', 'mcp'), listServers()),
      'mcp.add_server': (p) => (need('install'), requestMcpServer({ id: record.id, name: manifest.name }, p)),
      'plugins.installed': () => (need('install'), this.order.map((id) => this.summary(this.records.get(id)!))),
      'plugins.install': (p) => (need('install'), this.installFor(record, grants, p)),
      'plugins.marketplace.search': (p) => (need('install'), searchMarketplace(String(p.query ?? ''))),
      'services.call': (p) => this.broker.callService(this.peerOf(record), p),
      'services.list': () => this.broker.listServices(this.peerOf(record)),
      'shared.get': (p) => this.broker.sharedRequest(this.peerOf(record), 'shared.get', p),
      'shared.set': (p) => this.broker.sharedRequest(this.peerOf(record), 'shared.set', p),
      'shared.delete': (p) => this.broker.sharedRequest(this.peerOf(record), 'shared.delete', p),
      'shared.keys': (p) => this.broker.sharedRequest(this.peerOf(record), 'shared.keys', p),
      'shared.watch': (p) => this.broker.sharedRequest(this.peerOf(record), 'shared.watch', p),
      'ui.dialog': (p) => showPluginDialog(plugin, p),
      'settings.register': (p) => {
        const values = pluginSettings.register(record.id, manifest.module, (p.schema as UiNode[]) ?? [])
        this.emitChanged()
        return values
      },
      'settings.set': (p) => {
        pluginSettings.setFromPlugin(record.id, manifest.module, (p.values as Record<string, unknown>) ?? {})
        return null
      }
    }
  }

  private onNotification(record: PluginRecord, method: string, params: Record<string, unknown>): void {
    const name = record.manifest?.name ?? record.id
    const viewId = String(params.id ?? '')
    switch (method) {
      case 'app.log':
        this.log(String(params.level), String(params.message), name)
        return
      case 'sandbox.blocked': {
        const permission = String(params.permission) as PluginPermission
        this.log('warning', `sandbox blocked ${params.detail} (needs "${permission}")`, name)
        if (!record.blocked.has(permission)) {
          record.blocked.add(permission)
          this.emitChanged()
        }
        return
      }
      case 'events.publish':
        this.broker.publish(this.peerOf(record), String(params.topic ?? ''), params.data ?? null)
        return
      case 'events.subscriptions':
        this.emitChanged()
        return
      case 'ui.hud':
        hudHost.hud(record.id, name, params)
        return
      case 'ui.toast':
        hudHost.toast(name, params)
        return
      case 'ui.panel.open':
        void openPanel(this.panelPlugin(record), params).catch((err) => this.log('error', `panel: ${(err as Error).message}`, name))
        return
      case 'ui.panel.close':
        closePanel(record.id, viewId)
        return
      case 'ui.panel.title':
        setPanelTitle(record.id, viewId, String(params.title ?? ''))
        return
      case 'ui.render':
        renderPanel(record.id, viewId, params.tree as UiNode)
        return
      case 'ui.state':
        setPanelState(record.id, viewId, (params.state as Record<string, unknown>) ?? {})
        return
      default:
        this.log('warning', `unknown notification ${method}`, name)
    }
  }

  /** A UI event from a panel page, forwarded to the plugin that owns it. */
  sendUiEvent(pluginId: string, viewId: string, event: string, payload: unknown, handler?: string): Promise<unknown> {
    const record = this.records.get(pluginId)
    if (!record?.process?.running) return Promise.reject(new Error('The plugin is not running'))
    return record.process.request('ui.event', { id: viewId, event, payload, handler }, 5 * 60_000)
  }

  // --------------------------------------------------------------- internals

  private info(r: PluginRecord): PluginInfo {
    const m = r.manifest
    const grants = settings.get('pluginGrants')[r.id]
    return {
      id: r.id,
      name: m?.name ?? r.id,
      description: m?.description ?? '',
      version: m?.version ?? '',
      author: m?.author ?? '',
      sdkVersion: m?.sdkVersion ?? '',
      module: m?.module ?? '',
      actions: Object.keys(m?.actions ?? {}).sort(),
      enabled: this.enabled(r),
      loaded: !!r.load?.loaded && !!r.process?.running,
      state: r.problem ? 'error' : r.state,
      error: r.problem ?? r.error,
      folder: r.folder,
      icon: r.icon,
      permissions: m?.permissions ?? [],
      granted: m && grants ? effectiveGrants(m.permissions, grants) : [],
      legacy: m?.legacy ?? false,
      dependencies: m?.dependencies ?? {},
      services: r.load?.services ?? [],
      tools: (r.load?.tools ?? []).map((t) => t.name),
      subscriptions: r.process?.info?.subscriptions ?? r.load?.subscriptions ?? [],
      hooks: r.load?.hooks ?? [],
      panels: Object.keys(m?.panels ?? {}),
      hasSettings: pluginSettings.has(r.id),
      linked: r.linked,
      blocked: [...r.blocked]
    }
  }

  private emitChanged(): void {
    if (this.changedTimer) return
    this.changedTimer = setTimeout(() => {
      this.changedTimer = null
      this.emit('changed', this.list)
    }, 50)
  }

  private setStatus(patch: Partial<PluginRuntimeStatus>): void {
    this.runtime = { ...this.runtime, ...patch }
    this.emit('status', this.runtime)
  }

  log(level: string, message: string, plugin = 'host'): void {
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${plugin}] ${message}`
    if (level === 'error' || level === 'warning') console.warn(line)
    else console.log(line)
    try {
      mkdirSync(logsDir(), { recursive: true })
      appendFileSync(join(logsDir(), 'plugins.log'), line + '\n')
    } catch {
      // ignore logging failures
    }
  }
}

export const pluginHost = new PluginHost()

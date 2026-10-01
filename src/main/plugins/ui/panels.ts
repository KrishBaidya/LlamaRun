import { existsSync } from 'node:fs'
import { join, normalize, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, session, systemPreferences, type WebContents } from 'electron'
import type { PluginViewInit, UiNode } from '@shared/types'
import { userDataPath } from '../../paths'
import { appearance, chromeOptions, materialOptions, trackThemeForTitlebar } from '../../windows/load'
import { compilePanel, PanelCompileError, type CompiledPanel } from './compile'

export const PANEL_SCHEME = 'llamarun-plugin'
const ORIGIN = `${PANEL_SCHEME}://view`

/** Content-Security-Policy for panel pages: nothing leaves the machine. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

/** Must run before the app is ready. */
export function registerPanelScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: PANEL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }
  ])
}

export interface PanelPlugin {
  id: string
  name: string
  folder: string
  panels: Record<string, string>
}

interface PanelEntry {
  plugin: PanelPlugin
  viewId: string
  title: string
  win: BrowserWindow
  tree?: UiNode
  tsx?: string
  state?: Record<string, unknown>
  error?: string
}

type EventSender = (pluginId: string, viewId: string, event: string, payload: unknown, handler?: string) => Promise<unknown>

const panels = new Map<string, PanelEntry>()
const byContents = new Map<number, PanelEntry>()
const compiled = new Map<string, Map<string, CompiledPanel>>()
const sessionsReady = new Set<string>()
/** Windows showing plugin content: app-wide broadcasts skip them. */
export const pluginWindows = new WeakSet<BrowserWindow>()
let sendEvent: EventSender = async () => null

const key = (pluginId: string, viewId: string): string => `${pluginId}\u0000${viewId}`
const partitionFor = (pluginId: string): string => `persist:llamarun-plugin-${pluginId.replace(/[^A-Za-z0-9_-]/g, '_')}`

function devServer(): string | undefined {
  return !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
}

function shellUrl(): string {
  const dev = devServer()
  return dev ? `${dev}/plugin-view.html` : `${ORIGIN}/plugin-view.html`
}

/** A session per plugin: its own storage, only our scheme, and no network at all. */
function pluginSession(pluginId: string): Electron.Session {
  const partition = partitionFor(pluginId)
  const ses = session.fromPartition(partition)
  if (sessionsReady.has(partition)) return ses
  sessionsReady.add(partition)

  const rendererDir = join(__dirname, '../renderer')
  ses.protocol.handle(PANEL_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'view') return new Response('not found', { status: 404 })
    const bundle = /^\/~panel\/([A-Za-z_][A-Za-z0-9_]*)\.(js|css)$/.exec(url.pathname)
    if (bundle) {
      const code = compiled.get(pluginId)?.get(bundle[1])
      if (!code) return new Response('not found', { status: 404 })
      return new Response(bundle[2] === 'js' ? code.js : code.css, {
        headers: { 'content-type': bundle[2] === 'js' ? 'text/javascript' : 'text/css', 'cache-control': 'no-store' }
      })
    }
    // The panel page itself and its assets, from the built renderer.
    const file = normalize(join(rendererDir, decodeURIComponent(url.pathname)))
    const rel = relative(rendererDir, file)
    if (rel.startsWith('..') || rel.startsWith(sep) || !existsSync(file)) return new Response('not found', { status: 404 })
    const response = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(response.headers)
    if (file.endsWith('.html')) headers.set('content-security-policy', CSP)
    return new Response(response.body, { status: response.status, headers })
  })

  const dev = devServer()
  const devOrigin = dev ? new URL(dev).host : null
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    const ok =
      url.startsWith(`${PANEL_SCHEME}:`) ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('devtools:') ||
      (devOrigin !== null && /^(https?|wss?):/.test(url) && new URL(url).host === devOrigin)
    callback({ cancel: !ok })
  })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  return ses
}

async function compileFor(entry: PanelEntry): Promise<void> {
  const name = entry.tsx!
  const file = entry.plugin.panels[name]
  if (!file) {
    const known = Object.keys(entry.plugin.panels)
    throw new PanelCompileError(
      `No panel named "${name}". Register it in plugin.json: "ui": {"panels": {"${name}": "ui/${name}.tsx"}}${known.length ? ` (known: ${known.join(', ')})` : ''}`
    )
  }
  const result = await compilePanel(entry.plugin.folder, file, userDataPath('PluginUi', entry.plugin.id))
  const forPlugin = compiled.get(entry.plugin.id) ?? new Map<string, CompiledPanel>()
  forPlugin.set(name, result)
  compiled.set(entry.plugin.id, forPlugin)
}

function initFor(entry: PanelEntry): PluginViewInit {
  return {
    viewId: entry.viewId,
    pluginId: entry.plugin.id,
    pluginName: entry.plugin.name,
    title: entry.title,
    tree: entry.tree,
    bundle: entry.tsx && !entry.error ? `${ORIGIN}/~panel/${entry.tsx}.js` : undefined,
    stylesheet: entry.tsx && !entry.error ? `${ORIGIN}/~panel/${entry.tsx}.css` : undefined,
    state: entry.state,
    appearance: appearance(),
    error: entry.error
  }
}

export async function openPanel(plugin: PanelPlugin, params: Record<string, unknown>): Promise<void> {
  const viewId = String(params.id ?? '')
  const existing = panels.get(key(plugin.id, viewId))
  const title = String(params.title ?? plugin.name).slice(0, 200)
  if (existing && !existing.win.isDestroyed()) {
    existing.title = title
    existing.win.setTitle(`${title} - ${plugin.name}`)
    if (existing.win.isMinimized()) existing.win.restore()
    existing.win.show()
    existing.win.focus()
    return
  }

  const width = Math.max(280, Math.min(1600, Number(params.width) || 480))
  const height = Math.max(200, Math.min(1200, Number(params.height) || 560))
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 260,
    minHeight: 180,
    show: false,
    title: `${title} - ${plugin.name}`,
    ...chromeOptions(),
    ...materialOptions('mica'),
    webPreferences: {
      session: pluginSession(plugin.id),
      preload: join(__dirname, '../preload/pluginView.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      navigateOnDragDrop: false,
      safeDialogs: true
    }
  })
  pluginWindows.add(win)
  trackThemeForTitlebar(win)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())

  const entry: PanelEntry = {
    plugin,
    viewId,
    title,
    win,
    tree: params.tree as UiNode | undefined,
    tsx: typeof params.tsx === 'string' ? params.tsx : undefined,
    state: (params.state as Record<string, unknown>) ?? {}
  }
  panels.set(key(plugin.id, viewId), entry)
  byContents.set(win.webContents.id, entry)
  const contentsId = win.webContents.id
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    byContents.delete(contentsId)
    if (panels.get(key(plugin.id, viewId)) === entry) {
      panels.delete(key(plugin.id, viewId))
      void sendEvent(plugin.id, viewId, '$closed', null).catch(() => {})
    }
  })

  if (entry.tsx) {
    try {
      await compileFor(entry)
    } catch (err) {
      entry.error = (err as Error).message
    }
  }
  if (!win.isDestroyed()) await win.loadURL(shellUrl())
}

function send(entry: PanelEntry | undefined, channel: string, payload: unknown): void {
  if (entry && !entry.win.isDestroyed()) entry.win.webContents.send(channel, payload)
}

export function renderPanel(pluginId: string, viewId: string, tree: UiNode): void {
  const entry = panels.get(key(pluginId, viewId))
  if (!entry) return
  entry.tree = tree
  send(entry, 'pluginView:tree', tree)
}

export function setPanelState(pluginId: string, viewId: string, state: Record<string, unknown>): void {
  const entry = panels.get(key(pluginId, viewId))
  if (!entry) return
  entry.state = state
  send(entry, 'pluginView:state', state)
}

export function setPanelTitle(pluginId: string, viewId: string, title: string): void {
  const entry = panels.get(key(pluginId, viewId))
  if (!entry || entry.win.isDestroyed()) return
  entry.title = title
  entry.win.setTitle(`${title} - ${entry.plugin.name}`)
  send(entry, 'pluginView:title', title)
}

export function closePanel(pluginId: string, viewId: string): void {
  const entry = panels.get(key(pluginId, viewId))
  if (!entry) return
  panels.delete(key(pluginId, viewId)) // closed by the plugin: don't echo $closed back
  if (!entry.win.isDestroyed()) entry.win.close()
}

export function closePluginPanels(pluginId: string): void {
  for (const entry of [...panels.values()]) if (entry.plugin.id === pluginId) closePanel(pluginId, entry.viewId)
}

/** Recompile a plugin's open TSX panels and reload them (dev-linked plugins, on file change). */
export async function reloadPluginPanels(pluginId: string, plugin?: PanelPlugin): Promise<void> {
  compiled.delete(pluginId)
  for (const entry of panels.values()) {
    if (entry.plugin.id !== pluginId || !entry.tsx) continue
    if (plugin) entry.plugin = plugin
    entry.error = undefined
    try {
      await compileFor(entry)
    } catch (err) {
      entry.error = (err as Error).message
    }
    if (!entry.win.isDestroyed()) entry.win.webContents.reload()
  }
}

function entryFor(sender: WebContents): PanelEntry {
  const entry = byContents.get(sender.id)
  if (!entry) throw new Error('not a plugin panel')
  return entry
}

/** IPC for panel pages (see src/preload/pluginView.ts). Every message is tied to the panel that sent it. */
export function registerPanelIpc(onEvent: EventSender): void {
  sendEvent = onEvent
  ipcMain.handle('pluginView:init', (e) => initFor(entryFor(e.sender)))
  ipcMain.handle('pluginView:event', (e, event: unknown, payload: unknown, handler: unknown) => {
    const entry = entryFor(e.sender)
    if (typeof event !== 'string' || !event || (event.startsWith('$') && event !== '$callback')) {
      throw new Error('invalid event name')
    }
    return sendEvent(entry.plugin.id, entry.viewId, event, payload ?? null, typeof handler === 'string' ? handler : undefined)
  })
  ipcMain.handle('pluginView:close', (e) => {
    const entry = entryFor(e.sender)
    if (!entry.win.isDestroyed()) entry.win.close()
  })
  ipcMain.handle('pluginView:setTitle', (e, title: unknown) => {
    const entry = entryFor(e.sender)
    setPanelTitle(entry.plugin.id, entry.viewId, String(title ?? '').slice(0, 200))
  })

  const pushAppearance = (): void => {
    const info = appearance()
    for (const entry of panels.values()) send(entry, 'pluginView:appearance', info)
  }
  nativeTheme.on('updated', pushAppearance)
  if (process.platform === 'win32') systemPreferences.on('accent-color-changed', pushAppearance)
}

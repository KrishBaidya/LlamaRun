import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell, systemPreferences } from 'electron'
import type { EventChannel, EventChannels, InvokeChannel, InvokeChannels } from '@shared/ipc'
import type { Settings } from '@shared/types'
import { DEFAULT_CLOUD_MODEL } from '@shared/constants'
import { approvals } from './assistant/approval'
import { installBrief } from './assistant/builtins'
import { readDocument } from './attachments/read'
import { auth, PROFILE_FRESH_MS } from './auth'
import { chatService, contextFor } from './chats/service'
import { activeHotkey, registerHotkey } from './hotkey'
import { modelCatalog } from './llm'
import { listOllamaModels } from './llm/ollama'
import { configFromDirectoryEntry, isServerConfig } from './mcp/config'
import { clearDirectoryCache, getDirectoryServer, listDirectory, readmeUrl } from './mcp/directory'
import { mcp } from './mcp/manager'
import { memoryStore } from './memory/store'
import { pluginDataDir, pluginsDir } from './paths'
import { pluginHost } from './plugins/host'
import { inspectPlugin, installPlugin } from './plugins/install'
import { isPermission, PERMISSIONS } from './plugins/permissions'
import { getDialog, resolveDialog, sizeDialog } from './plugins/ui/dialogs'
import { hudHost } from './plugins/ui/hud'
import { pluginWindows, registerPanelIpc } from './plugins/ui/panels'
import { pluginSettings } from './plugins/ui/settingsForms'
import { settings } from './settings'
import { installSkills } from './skills/install'
import { skillsDir, skillStore } from './skills/store'
import { closeOnboarding } from './windows/onboarding'
import { openChatWindow } from './windows/chat'
import { appearance } from './windows/load'
import { closeModelMenu, openModelMenu, resizeModelMenu } from './windows/modelMenu'
import { hideOverlay, resizeOverlay, setOverlayChat, showOverlay } from './windows/overlay'
import { openSettings } from './windows/settings'

export function broadcast<E extends EventChannel>(channel: E, payload: EventChannels[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    // Plugin panels only ever get their own view's messages.
    if (!win.isDestroyed() && !pluginWindows.has(win)) win.webContents.send(channel, payload)
  }
}

function handle<C extends InvokeChannel>(
  channel: C,
  fn: (
    event: Electron.IpcMainInvokeEvent,
    ...args: Parameters<InvokeChannels[C]>
  ) => ReturnType<InvokeChannels[C]> | Promise<Awaited<ReturnType<InvokeChannels[C]>>>
): void {
  ipcMain.handle(channel, (event, ...args) => fn(event, ...(args as Parameters<InvokeChannels[C]>)))
}

/**
 * Theme CSS from plugins (the "appearance" permission), in every app window
 * except plugin panels. It goes in as the page's last <style>, so it wins over
 * the app's own rules for the same selectors (insertCSS sheets come first).
 */
async function injectCss(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed() || pluginWindows.has(win)) return
  const css = JSON.stringify(pluginHost.css())
  await win.webContents.executeJavaScript(
    `(() => { let s = document.getElementById('llamarun-plugin-theme'); const css = ${css};
      if (!css) { s?.remove(); return }
      if (!s) { s = document.createElement('style'); s.id = 'llamarun-plugin-theme' }
      s.textContent = css; document.head.appendChild(s) })()`
  )
}

function applyPluginCss(): void {
  for (const win of BrowserWindow.getAllWindows()) void injectCss(win).catch(() => {})
}

export function applyStartup(enabled: boolean): void {
  if (!app.isPackaged) return // don't register the dev electron binary as a login item
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}

export function registerIpc(): void {
  handle('app:version', () => app.getVersion())
  handle('app:openExternal', (_e, url) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
  handle('app:openSettings', (_e, route) => void openSettings(route ?? '/'))
  handle('app:quit', () => app.quit())
  handle('app:appearance', () => {
    const { dark: _dark, ...info } = appearance()
    return info
  })
  handle('app:openChat', (_e, chatId) => {
    hideOverlay()
    openChatWindow(chatId)
  })

  handle('settings:get', () => settings.all)
  handle('settings:set', (_e, patch) => {
    const allowed: (keyof Settings)[] = [
      'selectedModel',
      'appOpacity',
      'startupEnabled',
      'hotkey',
      'windowWidthPct',
      'windowHeightPct',
      'overlayNewChatAfterMinutes',
      'memoryEnabled',
      'skillsEnabled',
      'allowedCommands',
      'autoCompact',
      'autoCompactPercent',
      'compactKeepTurns',
      'modelContext'
    ]
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k as keyof Settings)))
    return settings.set(clean)
  })
  handle('settings:reset', () => settings.reset())
  handle('settings:hotkeyStatus', () => ({ active: activeHotkey(), requested: settings.get('hotkey') }))

  handle('models:list', (_e, options) => modelCatalog({ force: options?.force === true }))

  handle('chats:list', () => chatService.list())
  handle('chats:get', (_e, id) => chatService.get(id))
  handle('chats:create', (_e, model) => chatService.create(model))
  handle('chats:rename', (_e, id, title) => chatService.rename(id, title))
  handle('chats:delete', (_e, id) => chatService.delete(id))
  handle('chats:setModel', (_e, id, model) => chatService.setModel(id, model))
  handle('chats:send', (_e, chatId, text, model, attachments) => chatService.send(chatId, text, model, attachments))
  handle('chats:compact', (_e, id, instructions) => chatService.compact(id, instructions))
  handle('chats:answerApproval', (_e, id, answer) => approvals.answer(id, answer))
  handle('chats:pendingApproval', (_e, chatId) => approvals.current(chatId))
  handle('chats:contextUsage', (_e, id, model) => chatService.contextUsage(id, model))
  handle('models:context', (_e, models) => Promise.all(models.map((m) => contextFor(m))))
  handle('chats:cancel', (_e, id) => chatService.cancel(id))
  handle('chats:retry', (_e, id) => chatService.retry(id))
  handle('chats:continue', (_e, id) => void chatService.continue(id))

  handle('attachments:read', (_e, name, mimeType, bytes) => readDocument(String(name), String(mimeType ?? ''), bytes))

  handle('memory:list', () => memoryStore.list())
  handle('memory:add', (_e, text) => (memoryStore.add(String(text), 'user'), memoryStore.list()))
  handle('memory:update', (_e, id, text) => (memoryStore.update(id, String(text), 'user'), memoryStore.list()))
  handle('memory:remove', (_e, id) => (memoryStore.remove(id), memoryStore.list()))
  handle('memory:clear', () => (memoryStore.clear(), memoryStore.list()))

  handle('skills:list', () => skillStore.list())
  handle('skills:install', (_e, source) => installSkills(String(source)))
  handle('skills:installWithAi', (_e, source) => {
    openChatWindow(chatService.startInstaller(installBrief(String(source).trim())))
  })
  handle('skills:pick', async (e, kind) => {
    const parent = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const options: Electron.OpenDialogOptions =
      kind === 'zip'
        ? { title: 'Choose a skill ZIP', properties: ['openFile'], filters: [{ name: 'Skill', extensions: ['zip', 'skill'] }] }
        : { title: 'Choose a skill folder', properties: ['openDirectory'] }
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return picked.canceled ? null : (picked.filePaths[0] ?? null)
  })
  handle('skills:remove', (_e, id) => (skillStore.remove(id), skillStore.list()))
  handle('skills:setEnabled', (_e, id, enabled) => (skillStore.setEnabled(id, enabled), skillStore.list()))
  handle('skills:setTrusted', (_e, id, trusted) => (skillStore.setTrusted(id, trusted), skillStore.list()))
  handle('skills:openFolder', (_e, id) => {
    const folder = id ? skillStore.list().find((s) => s.id === id)?.folder : skillsDir()
    if (!folder) return
    mkdirSync(folder, { recursive: true })
    void shell.openPath(folder)
  })

  handle('commands:list', () => chatService.commands())

  handle('overlay:hide', () => hideOverlay())
  handle('overlay:resize', (_e, height) => resizeOverlay(Number(height)))
  handle('modelMenu:open', (e, anchor, value) => {
    const parent = BrowserWindow.fromWebContents(e.sender)
    if (!parent) return
    return openModelMenu(parent, anchor, String(value ?? ''), (chosen, refocus) => {
      if (parent.isDestroyed()) return
      parent.webContents.send('overlay:modelMenu', { chosen: chosen ?? null })
      if (refocus && parent.isVisible()) parent.focus()
    })
  })
  handle('modelMenu:choose', (_e, model) => closeModelMenu(String(model)))
  handle('modelMenu:close', () => closeModelMenu())
  handle('modelMenu:resize', (_e, height) => resizeModelMenu(Number(height)))
  handle('overlay:setChat', (_e, chatId) => setOverlayChat(chatId))

  handle('onboarding:finish', async (_e, mode) => {
    if (!settings.get('selectedModel')) {
      const local = mode === 'skip' ? await listOllamaModels() : []
      settings.set({ selectedModel: local[0]?.id ?? DEFAULT_CLOUD_MODEL })
    }
    settings.set({ isFirstRun: false })
    closeOnboarding()
    showOverlay()
  })

  handle('auth:signIn', () => auth.openLogin())
  handle('auth:signOut', () => auth.signOut())
  handle('auth:profile', () => auth.profile())
  handle('account:openUpgrade', () => auth.openUpgrade())
  handle('account:openAccount', () => auth.openAccount())
  handle('account:refresh', () => auth.refreshProfile({ maxAgeMs: PROFILE_FRESH_MS }))

  handle('mcp:list', () => mcp.servers())
  handle('mcp:status', () => mcp.statuses())
  handle('mcp:tools', () => mcp.tools())
  handle('mcp:saveServer', async (_e, server) => {
    if (!isServerConfig(server)) throw new Error('Invalid MCP server configuration')
    await mcp.saveServer(server)
  })
  handle('mcp:remove', (_e, name) => mcp.remove(name))
  handle('mcp:directory', (_e, query) => listDirectory(query))
  handle('mcp:clearDirectoryCache', () => clearDirectoryCache())
  handle('mcp:directoryServer', (_e, id) => getDirectoryServer(id))
  handle('mcp:readmeUrl', (_e, id) => readmeUrl(id))
  handle('mcp:configFromDirectory', (_e, server) => configFromDirectoryEntry(server.name, server.serverConfig))

  handle('plugins:list', async () => {
    await pluginHost.start()
    return pluginHost.list
  })
  handle('plugins:runtime', () => pluginHost.status)
  handle('plugins:setEnabled', (_e, id, enabled) => pluginHost.setEnabled(id, enabled))
  handle('plugins:reload', (_e, id) => pluginHost.reload(id))
  handle('plugins:remove', (_e, id) => pluginHost.remove(id))
  handle('plugins:inspect', async (event, kind) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const options: Electron.OpenDialogOptions =
      kind === 'zip'
        ? { title: 'Install plugin (.zip)', properties: ['openFile'], filters: [{ name: 'Plugin archive', extensions: ['zip'] }] }
        : { title: kind === 'link' ? 'Link a plugin folder for development' : 'Select plugin folder', properties: ['openDirectory'] }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return inspectPlugin(result.filePaths[0], kind)
  })
  handle('plugins:install', async (_e, source, kind, grants) => {
    const approved = (grants ?? []).filter(isPermission)
    const id = await installPlugin(source, kind, approved)
    pluginHost.log('info', `installed plugin ${id} (${kind}) with permissions: ${approved.join(', ') || 'none'}`)
    return pluginHost.reload()
  })
  handle('plugins:setGrants', (_e, id, grants) => pluginHost.setGrants(id, (grants ?? []).filter(isPermission)))
  handle('plugins:permissionCatalog', () => Object.values(PERMISSIONS))
  handle('plugins:settings', (_e, id) => pluginHost.settingsView(id))
  handle('plugins:saveSettings', (_e, id, values) => pluginHost.saveSettings(id, values ?? {}))
  handle('plugins:openFolder', () => void shell.openPath(pluginsDir()))
  handle('plugins:openDataFolder', (_e, id) => {
    const manifest = pluginHost.manifestOf(id)
    if (!manifest) throw new Error(`Unknown plugin: ${id}`)
    const dir = join(pluginDataDir(), manifest.module)
    mkdirSync(dir, { recursive: true })
    void shell.openPath(dir)
  })
  handle('plugins:runAction', (_e, id, action) => pluginHost.runAction(id, action))

  handle('hud:get', () => hudHost.snapshot())
  handle('hud:click', (_e, key) => hudHost.click(key))
  handle('hud:dismiss', (_e, key) => hudHost.dismiss(key))
  handle('hud:setInteractive', (_e, interactive) => hudHost.setInteractive(!!interactive))
  handle('pluginDialog:get', (_e, id) => getDialog(id))
  handle('pluginDialog:resolve', (_e, id, value) => resolveDialog(id, value))
  handle('pluginDialog:resize', (_e, id, height) => sizeDialog(id, height))
  registerPanelIpc((pluginId, viewId, event, payload, handler) => pluginHost.sendUiEvent(pluginId, viewId, event, payload, handler))

  // Side effects of settings changes.
  settings.on('changed', (all, patch) => {
    if ('hotkey' in patch) registerHotkey(false)
    if ('startupEnabled' in patch) applyStartup(all.startupEnabled)
    broadcast('settings:changed', all)
  })
  auth.on('changed', (profile) => broadcast('auth:changed', profile))
  mcp.on('changed', (statuses) => broadcast('mcp:changed', statuses))
  pluginHost.on('changed', (list) => broadcast('plugins:changed', list))
  pluginHost.on('commands', () => broadcast('commands:changed', chatService.commands()))
  pluginHost.on('css', applyPluginCss)
  app.on('browser-window-created', (_e, win) => {
    win.webContents.on('did-finish-load', () => void injectCss(win).catch(() => {}))
  })
  memoryStore.on('changed', (list) => broadcast('memory:changed', list))
  approvals.on('changed', (chatId, request) => {
    broadcast('chat:event', { type: 'approval', chatId, request })
    // Nobody can answer a question in a chat no window shows: open it.
    if (request && !BrowserWindow.getAllWindows().some((w) => w.isVisible() && w.webContents.getURL().includes(chatId))) {
      openChatWindow(chatId)
    }
  })
  skillStore.on('changed', (list) => broadcast('skills:changed', list))
  pluginSettings.on('changed', (id) => broadcast('plugins:settingsChanged', id))
  chatService.on('event', (event) => broadcast('chat:event', event))
  chatService.on('changed', (list) => broadcast('chats:changed', list))
  if (process.platform === 'win32') {
    systemPreferences.on('accent-color-changed', () => broadcast('settings:changed', settings.all))
  }
}

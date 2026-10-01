import { appendFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, dialog } from 'electron'
import { PROTOCOL } from '@shared/constants'
import { auth } from './auth'
import { registerHotkey } from './hotkey'
import { applyStartup, registerIpc } from './ipc'
import { mcp } from './mcp/manager'
import { logsDir } from './paths'
import { pluginHost } from './plugins/host'
import { registerPanelScheme } from './plugins/ui/panels'
import { settings } from './settings'
import { createTray } from './tray'
import { openOnboarding } from './windows/onboarding'
import { createOverlay, markQuitting, showOverlay } from './windows/overlay'

// ---------------------------------------------------------------- crash log

function logCrash(kind: string, err: unknown): void {
  try {
    mkdirSync(logsDir(), { recursive: true })
    const detail = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    appendFileSync(join(logsDir(), 'crash.log'), `${new Date().toISOString()} [${kind}] ${detail}\n\n`)
  } catch {
    // nothing else we can do
  }
  console.error(`[${kind}]`, err)
}
process.on('uncaughtException', (err) => logCrash('uncaughtException', err))
process.on('unhandledRejection', (err) => logCrash('unhandledRejection', err))

// Separate profile for development/testing, e.g. LLAMARUN_USER_DATA=./.devdata
if (process.env.LLAMARUN_USER_DATA) app.setPath('userData', resolve(process.env.LLAMARUN_USER_DATA))

// Plugin panels load from their own scheme; it must be registered before 'ready'.
registerPanelScheme()

// ---------------------------------------------------------- single instance

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }

  const protocolUrlIn = (argv: string[]): string | undefined => argv.find((a) => a.startsWith(`${PROTOCOL}://`))
  let pendingUrl = protocolUrlIn(process.argv)

  app.on('second-instance', (_e, argv) => {
    const url = protocolUrlIn(argv)
    if (url) void auth.handleProtocolUrl(url)
    else if (settings.get('isFirstRun')) openOnboarding()
    else showOverlay()
  })
  app.on('open-url', (e, url) => {
    e.preventDefault()
    if (app.isReady()) void auth.handleProtocolUrl(url)
    else pendingUrl = url
  })

  // Stay resident in the tray when every window is closed.
  app.on('window-all-closed', () => {})

  let shuttingDown = false
  app.on('before-quit', (e) => {
    markQuitting()
    if (shuttingDown) return
    shuttingDown = true
    e.preventDefault()
    // Give plugins their on_unload and close MCP servers before exiting.
    void Promise.allSettled([pluginHost.stop(), mcp.stop()]).finally(() => app.quit())
  })

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.krishbaidya.llamarun')
    registerIpc()
    createTray()
    createOverlay()
    registerHotkey()
    applyStartup(settings.get('startupEnabled'))

    void mcp.start()
    void pluginHost.start()
    void auth.refreshProfile()
    if (pendingUrl) void auth.handleProtocolUrl(pendingUrl)

    const hidden = process.argv.includes('--hidden')
    if (settings.get('isFirstRun')) openOnboarding()
    else if (!hidden && !app.isPackaged) showOverlay()
  }).catch((err) => {
    logCrash('startup', err)
    dialog.showErrorBox('Llama Run failed to start', String(err))
    app.exit(1)
  })

  app.on('web-contents-created', (_e, contents) => {
    contents.on('render-process-gone', (_ev, details) => logCrash('render-process-gone', details.reason))
  })
}


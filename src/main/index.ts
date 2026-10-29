import { appendFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, dialog } from 'electron'
import { PROTOCOL } from '@shared/constants'
import { auth, PROFILE_FRESH_MS } from './auth'
import { closeDriver, warmDriver } from './computer/driver'
import { registerHotkey } from './hotkey'
import { applyStartup, registerIpc } from './ipc'
import { cloudUsage } from './llm/cloud'
import { mcp } from './mcp/manager'
import { logsDir } from './paths'
import { installBundledPlugins } from './plugins/bundled'
import { pluginHost } from './plugins/host'
import { hudHost } from './plugins/ui/hud'
import { registerPanelScheme } from './plugins/ui/panels'
import { settings } from './settings'
import { createTray } from './tray'
import { openOnboarding } from './windows/onboarding'
import { attachContextMenu } from './windows/contextMenu'
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

// ------------------------------------------------------------- deep links

/** How long to wait before re-reading a just-paid plan the payment webhook may not have activated yet. */
const BILLING_RECHECK_MS = 5000

/** `llama-run://billing?status=success|cancelled`: the website's checkout finished. */
async function handleBillingReturn(status: string | null): Promise<void> {
  if (status !== 'success') {
    hudHost.toast('Llama Run', { message: 'Checkout cancelled', description: 'Your plan hasn’t changed.', kind: 'info' })
    return
  }
  let profile = await auth.refreshProfile()
  if (profile.signedIn && profile.plan?.tier !== 'pro') {
    hudHost.toast('Llama Run', { message: 'Payment received', description: 'Activating LlamaRun Pro…', kind: 'info' })
    await new Promise((r) => setTimeout(r, BILLING_RECHECK_MS))
    profile = await auth.refreshProfile()
  }
  if (!profile.signedIn) {
    hudHost.toast('Llama Run', { message: 'Payment received', description: 'Sign in to see your LlamaRun Pro plan.', kind: 'info' })
  } else if (profile.plan?.tier === 'pro') {
    hudHost.toast('Llama Run', { message: 'Welcome to LlamaRun Pro', description: 'Your new limits are active.', kind: 'success' })
  } else {
    hudHost.toast('Llama Run', {
      message: 'Still activating LlamaRun Pro',
      description: 'Your payment is being confirmed. Your plan updates in Settings within a few minutes.',
      kind: 'info',
      duration: 8
    })
    auth.scheduleRefresh(30_000)
  }
}

function handleProtocolUrl(rawUrl: string): void {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return
  }
  if (url.protocol === `${PROTOCOL}:` && url.hostname === 'billing') {
    void handleBillingReturn(url.searchParams.get('status'))
    return
  }
  void auth.handleProtocolUrl(rawUrl)
}

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
    if (url) handleProtocolUrl(url)
    else if (settings.get('isFirstRun')) openOnboarding()
    else showOverlay()
  })
  app.on('open-url', (e, url) => {
    e.preventDefault()
    if (app.isReady()) handleProtocolUrl(url)
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
    // Give plugins their on_unload, close MCP servers and stop the computer-use driver before exiting.
    void Promise.allSettled([pluginHost.stop(), mcp.stop(), closeDriver()]).finally(() => app.quit())
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
    void installBundledPlugins()
    if (settings.get('computerUse')) warmDriver()
    settings.on('changed', (_all, patch) => {
      if (patch.computerUse) warmDriver()
    })
    // Re-read plan usage shortly after cloud replies (and plan/quota refusals).
    cloudUsage.on('changed', () => auth.scheduleRefresh())
    void auth.refreshProfile({ maxAgeMs: PROFILE_FRESH_MS })
    if (pendingUrl) handleProtocolUrl(pendingUrl)

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
    attachContextMenu(contents)
  })
}


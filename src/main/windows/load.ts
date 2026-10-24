import { release } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, shell, systemPreferences } from 'electron'
import type { AppearanceInfo } from '@shared/types'

export type Page = 'overlay' | 'model-menu' | 'settings' | 'onboarding' | 'chat' | 'hud' | 'dialog' | 'plugin-view'

export function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

export function loadPage(win: BrowserWindow, page: Page, hash = ''): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) {
    void win.loadURL(`${devUrl}/${page}.html${hash ? `#${hash}` : ''}`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`), hash ? { hash } : undefined)
  }
}

/** Open external links in the default browser instead of new Electron windows. */
export function hardenNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (url.split('#')[0] !== current.split('#')[0]) {
      event.preventDefault()
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    }
  })
}

export const baseWebPreferences = (): Electron.WebPreferences => ({
  preload: preloadPath(),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: true
})

/** Mica/Acrylic via backgroundMaterial need Windows 11 22H2 (build 22621) or newer. */
export function supportsMaterial(): boolean {
  if (process.platform !== 'win32') return false
  const build = Number(release().split('.')[2] ?? 0)
  return build >= 22621
}

export function materialOptions(material: 'acrylic' | 'mica'): Partial<Electron.BrowserWindowConstructorOptions> {
  if (process.platform === 'win32') {
    return supportsMaterial()
      ? { backgroundMaterial: material, backgroundColor: '#00000000' }
      : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#fcfcfc' }
  }
  if (process.platform === 'darwin') {
    return { vibrancy: material === 'acrylic' ? 'hud' : 'sidebar', visualEffectState: 'active', transparent: true }
  }
  return {}
}

/** Platform, Windows accent colour and backdrop support, for renderer theming. */
export function appearance(): AppearanceInfo & { dark: boolean } {
  return {
    platform: process.platform,
    accentColor: process.platform === 'win32' ? `#${systemPreferences.getAccentColor().slice(0, 6)}` : null,
    material: supportsMaterial(),
    dark: nativeTheme.shouldUseDarkColors
  }
}

export const TITLEBAR_HEIGHT = 40

function overlayColors(): Electron.TitleBarOverlay {
  return {
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#e5e5e5' : '#27272a',
    height: TITLEBAR_HEIGHT
  }
}

/**
 * Native window chrome: on Windows the page draws its own title area while the
 * OS keeps the real (Fluent) caption buttons; on macOS the traffic lights sit
 * inset in the page. The renderer reserves TITLEBAR_HEIGHT px at the top.
 */
export function chromeOptions(): Partial<Electron.BrowserWindowConstructorOptions> {
  if (process.platform === 'win32') return { titleBarStyle: 'hidden', titleBarOverlay: overlayColors() }
  if (process.platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 13 } }
  return {}
}

/** Keep caption-button colours in step with light/dark mode. */
export function trackThemeForTitlebar(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  const update = (): void => {
    if (!win.isDestroyed()) win.setTitleBarOverlay(overlayColors())
  }
  nativeTheme.on('updated', update)
  win.on('closed', () => nativeTheme.off('updated', update))
}

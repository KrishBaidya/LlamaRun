import { BrowserWindow } from 'electron'
import { iconPath } from '../paths'
import { baseWebPreferences, hardenNavigation, loadPage, materialOptions } from './load'

let win: BrowserWindow | null = null

export function openOnboarding(): BrowserWindow {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return win
  }
  win = new BrowserWindow({
    width: 900,
    height: 640,
    resizable: false,
    maximizable: false,
    show: false,
    title: 'Welcome to Llama Run',
    icon: iconPath(),
    autoHideMenuBar: true,
    ...materialOptions('mica'),
    webPreferences: baseWebPreferences()
  })
  win.removeMenu()
  hardenNavigation(win)
  loadPage(win, 'onboarding')
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  return win
}

export function closeOnboarding(): void {
  if (win && !win.isDestroyed()) win.close()
}

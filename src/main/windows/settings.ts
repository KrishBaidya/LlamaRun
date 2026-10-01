import { BrowserWindow } from 'electron'
import { iconPath } from '../paths'
import {
  baseWebPreferences,
  chromeOptions,
  hardenNavigation,
  loadPage,
  materialOptions,
  trackThemeForTitlebar
} from './load'

let win: BrowserWindow | null = null

export function openSettings(route = '/'): BrowserWindow {
  if (win && !win.isDestroyed()) {
    win.webContents.send('settings:navigate', route)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return win
  }
  win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Llama Run Settings',
    icon: iconPath(),
    autoHideMenuBar: true,
    ...materialOptions('mica'),
    ...chromeOptions(),
    webPreferences: baseWebPreferences()
  })
  win.removeMenu()
  hardenNavigation(win)
  trackThemeForTitlebar(win)
  loadPage(win, 'settings', route)
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  return win
}

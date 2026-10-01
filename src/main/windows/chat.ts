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

/** Opens (or focuses) the full chat window, optionally switching to a chat. */
export function openChatWindow(chatId?: string | null): BrowserWindow {
  if (win && !win.isDestroyed()) {
    if (chatId !== undefined) win.webContents.send('chat:open', chatId)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return win
  }
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'Llama Run',
    icon: iconPath(),
    autoHideMenuBar: true,
    ...materialOptions('mica'),
    ...chromeOptions(),
    webPreferences: baseWebPreferences()
  })
  win.removeMenu()
  hardenNavigation(win)
  trackThemeForTitlebar(win)
  loadPage(win, 'chat', chatId ? `/c/${chatId}` : '')
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  return win
}

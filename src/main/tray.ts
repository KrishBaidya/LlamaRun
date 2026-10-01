import { app, Menu, nativeImage, Tray } from 'electron'
import { iconPath } from './paths'
import { settings } from './settings'
import { openChatWindow } from './windows/chat'
import { openSettings } from './windows/settings'
import { showOverlay } from './windows/overlay'

let tray: Tray | null = null

function prettyHotkey(accelerator: string): string {
  return accelerator.replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl')
}

export function createTray(): Tray {
  const image = nativeImage.createFromPath(iconPath(process.platform === 'win32' ? 'icon.ico' : 'tray.png'))
  tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(iconPath('tray.png')) : image)
  tray.setToolTip('Llama Run')
  const menu = (): Menu =>
    Menu.buildFromTemplate([
      { label: `Ask Llama Run  (${prettyHotkey(settings.get('hotkey'))})`, click: () => showOverlay() },
      { label: 'Chats', click: () => openChatWindow() },
      { label: 'New Chat', click: () => openChatWindow(null) },
      { type: 'separator' },
      { label: 'Settings', click: () => openSettings('/') },
      { label: 'Plugins', click: () => openSettings('/plugins') },
      { label: 'MCP Servers', click: () => openSettings('/mcp') },
      { type: 'separator' },
      { label: 'Quit Llama Run', click: () => app.quit() }
    ])
  // Left click opens Settings (as in the WinUI app); right click shows the menu.
  tray.on('click', () => openSettings('/'))
  tray.on('right-click', () => tray?.popUpContextMenu(menu()))
  if (process.platform !== 'win32') tray.setContextMenu(menu())
  return tray
}

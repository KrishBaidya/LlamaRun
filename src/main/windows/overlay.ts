import { BrowserWindow, screen } from 'electron'
import { chatStore } from '../chats/store'
import { settings } from '../settings'
import { baseWebPreferences, hardenNavigation, loadPage, materialOptions } from './load'

let win: BrowserWindow | null = null
let quitting = false
/** The thread the hotkey overlay is continuing. */
let overlayChatId: string | null = null

export function setOverlayChat(chatId: string | null): void {
  overlayChatId = chatId
}

/** Continue the last overlay chat unless it has been idle for longer than the configured limit. */
function chatForOverlay(): string | null {
  const chat = overlayChatId ? chatStore.get(overlayChatId) : undefined
  if (!chat) return (overlayChatId = null)
  const limit = settings.get('overlayNewChatAfterMinutes')
  if (limit > 0 && Date.now() - chat.updatedAt > limit * 60_000) overlayChatId = null
  return overlayChatId
}

export function markQuitting(): void {
  quitting = true
}

export function getOverlay(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function createOverlay(): BrowserWindow {
  if (getOverlay()) return win!
  win = new BrowserWindow({
    width: 800,
    height: 500,
    show: false,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Llama Run',
    ...materialOptions('acrylic'),
    webPreferences: baseWebPreferences()
  })
  win.setAlwaysOnTop(true, 'floating')
  hardenNavigation(win)
  loadPage(win, 'overlay')

  // Hide rather than close, and hide when focus moves elsewhere (like the WinUI app).
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('blur', () => {
    if (win && !win.webContents.isDevToolsOpened()) win.hide()
  })
  return win
}

/** Size as a percentage of the work area of the display under the cursor, centered. */
function position(w: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const width = Math.round((area.width * settings.get('windowWidthPct')) / 100)
  const height = Math.round((area.height * settings.get('windowHeightPct')) / 100)
  w.setBounds({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height
  })
}

export function showOverlay(): void {
  const w = createOverlay()
  position(w)
  w.show()
  w.focus()
  w.webContents.send('overlay:shown', { opacity: settings.get('appOpacity'), chatId: chatForOverlay() })
}

export function hideOverlay(): void {
  getOverlay()?.hide()
}

export function toggleOverlay(): void {
  const w = getOverlay()
  if (w?.isVisible()) w.hide()
  else showOverlay()
}

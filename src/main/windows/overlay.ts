import { BrowserWindow, screen } from 'electron'
import { chatStore } from '../chats/store'
import { settings } from '../settings'
import { baseWebPreferences, hardenNavigation, loadPage, materialOptions } from './load'
import { closeModelMenu, isModelMenu } from './modelMenu'

let win: BrowserWindow | null = null
/** Spotlight-style: a bar near the top of the screen that grows down with its content. */
/** The overlay is never shorter than this (px); short content is padded to it. */
const MIN_HEIGHT = 360
const MIN_WIDTH = 520
const MAX_WIDTH = 860
/** Where the bar sits, as a fraction of the work area's height. */
const TOP = 0.18
/** Last content height the renderer reported, reused when the overlay shows again. */
let contentHeight = 320
let maxHeight = 560
/** Where the overlay was placed. Resizing only ever changes the height: reading the bounds
    back and setting them again drifts the width on scaled displays. */
let placement: { x: number; y: number; width: number } | null = null
let quitting = false
/** The thread the hotkey overlay is continuing. */
let overlayChatId: string | null = null
/** A file picker the overlay opened is showing; it takes focus but the overlay should stay. */
let holdOpen = false

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
    width: 720,
    height: contentHeight,
    show: false,
    frame: false,
    resizable: false,
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
  win.on('show', () => {
    if (!placement && win) placement = (({ x, y, width }) => ({ x, y, width }))(win.getBounds())
  })
  hardenNavigation(win)
  loadPage(win, 'overlay')

  // Hide rather than close, and hide when focus moves elsewhere (like the WinUI app).
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
  })
  // The picker closed and focus came back.
  win.on('focus', () => (holdOpen = false))
  win.on('blur', () => {
    // Focus may be moving into the overlay's own model menu (a separate window); only hide
    // if it went somewhere else. The menu hides the overlay itself if you click away from both.
    setTimeout(() => {
      if (!win || !win.isVisible() || win.webContents.isDevToolsOpened() || holdOpen) return
      if (isModelMenu(BrowserWindow.getFocusedWindow())) return
      win.hide()
    }, 30)
  })
  win.on('hide', () => closeModelMenu(undefined, false))
  return win
}

/**
 * Centred near the top of the display under the cursor. The width comes from the
 * "Overlay size" setting; its height setting caps how far the overlay grows.
 */
function position(w: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, (area.width * settings.get('windowWidthPct')) / 100)))
  const y = Math.round(area.y + area.height * TOP)
  maxHeight = Math.round(
    Math.max(MIN_HEIGHT, Math.min((area.height * settings.get('windowHeightPct')) / 100, area.y + area.height - y - 24))
  )
  placement = { x: Math.round(area.x + (area.width - width) / 2), y, width }
  w.setBounds({ ...placement, height: clampHeight(contentHeight) })
}

function clampHeight(height: number): number {
  return Math.round(Math.max(MIN_HEIGHT, Math.min(maxHeight, height)))
}

/** The renderer measured its content: grow or shrink downward, keeping the top edge still. */
export function resizeOverlay(height: number): void {
  const w = getOverlay()
  if (!w || !Number.isFinite(height)) return
  contentHeight = height
  const next = clampHeight(height)
  if (!placement || next === w.getBounds().height) return
  w.setBounds({ ...placement, height: next })
}

export function showOverlay(): void {
  const w = createOverlay()
  position(w)
  w.show()
  w.focus()
  w.webContents.send('overlay:shown', { opacity: settings.get('appOpacity'), chatId: chatForOverlay(), minHeight: MIN_HEIGHT, maxHeight })
}

/** Keeps the overlay up while a file picker it opened has focus (cleared when the overlay is focused again). */
export function holdOverlayOpen(sender: Electron.WebContents): void {
  if (getOverlay()?.webContents === sender) holdOpen = true
}

export function hideOverlay(): void {
  holdOpen = false
  getOverlay()?.hide()
}

export function toggleOverlay(): void {
  const w = getOverlay()
  if (w?.isVisible()) w.hide()
  else showOverlay()
}

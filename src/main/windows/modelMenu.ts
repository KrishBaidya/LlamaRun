import { BrowserWindow, screen } from 'electron'
import type { MenuAnchor } from '@shared/types'
import { baseWebPreferences, hardenNavigation, loadPage, materialOptions } from './load'

/**
 * The overlay's model dropdown, in its own small window. The overlay is a
 * Spotlight-style bar exactly as tall as its content, so a dropdown drawn inside
 * it would have to make the whole bar taller; a separate window (like Windows'
 * own flyouts) hangs below it instead.
 */

const WIDTH = 352
const GAP = 6
const MAX_HEIGHT = 460

let menu: BrowserWindow | null = null
let ready: Promise<void> | null = null
let placement: { x: number; y: number; maxHeight: number } | null = null
let height = 400
let done: ((chosen: string | undefined, refocus: boolean) => void) | null = null

function create(parent: BrowserWindow): BrowserWindow {
  const w = new BrowserWindow({
    parent,
    width: WIDTH,
    height,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: 'Choose a model',
    ...materialOptions('acrylic'),
    webPreferences: baseWebPreferences()
  })
  w.setAlwaysOnTop(true, 'pop-up-menu')
  hardenNavigation(w)
  ready = new Promise((resolve) => w.webContents.once('did-finish-load', () => resolve()))
  loadPage(w, 'model-menu')
  // A click anywhere else closes the menu. If that click wasn't on the overlay
  // itself, the overlay goes too, as it would without the menu.
  w.on('blur', () => {
    closeModelMenu(undefined, false)
    setTimeout(() => {
      if (!parent.isDestroyed() && parent.isVisible() && BrowserWindow.getFocusedWindow() !== parent) parent.hide()
    }, 50)
  })
  w.on('closed', () => {
    menu = null
    ready = null
  })
  return w
}

export function isModelMenu(win: BrowserWindow | null): boolean {
  return !!win && win === menu
}

/**
 * Opens the menu under `anchor` (the model button, in the overlay's page
 * coordinates), right-aligned with it. `onDone` gets the chosen model, or
 * undefined if it was dismissed, and whether the overlay should take focus back.
 */
export async function openModelMenu(
  parent: BrowserWindow,
  anchor: MenuAnchor,
  value: string,
  onDone: (chosen: string | undefined, refocus: boolean) => void
): Promise<void> {
  if (!menu || menu.isDestroyed() || menu.getParentWindow() !== parent) {
    menu?.destroy()
    menu = create(parent)
  }
  done = onDone
  await ready
  if (!menu || menu.isDestroyed()) return

  const page = parent.getContentBounds()
  const area = screen.getDisplayMatching(page).workArea
  const x = Math.round(Math.min(Math.max(page.x + anchor.x + anchor.width - WIDTH, area.x + 8), area.x + area.width - WIDTH - 8))
  const y = Math.round(page.y + anchor.y + anchor.height + GAP)
  placement = { x, y, maxHeight: Math.max(160, Math.min(MAX_HEIGHT, area.y + area.height - y - 8)) }
  menu.setBounds({ x, y, width: WIDTH, height: Math.min(height, placement.maxHeight) })
  menu.webContents.send('modelMenu:show', { value })
  menu.show()
  menu.focus()
}

/** The menu page measured its content. Only the height changes (see resizeOverlay). */
export function resizeModelMenu(next: number): void {
  if (!Number.isFinite(next)) return
  height = Math.round(next)
  if (!menu || menu.isDestroyed() || !placement) return
  const h = Math.max(120, Math.min(height, placement.maxHeight))
  if (h !== menu.getBounds().height) menu.setBounds({ x: placement.x, y: placement.y, width: WIDTH, height: h })
}

export function closeModelMenu(chosen?: string, refocus = true): void {
  if (!menu || menu.isDestroyed() || !menu.isVisible()) return
  menu.hide()
  const callback = done
  done = null
  callback?.(chosen, refocus)
}

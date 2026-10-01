import { BrowserWindow, screen } from 'electron'
import type { HudIndicator, HudItem, HudSnapshot, ToastItem } from '@shared/types'
import { baseWebPreferences, hardenNavigation, loadPage } from '../../windows/load'

const WIDTH = 460
const HEIGHT = 420
const MARGIN = 16
const INDICATORS: HudIndicator[] = ['none', 'spinner', 'pulse', 'bars', 'dot', 'error']

type ClickHandler = (pluginId: string, hudId: string, event: 'click' | 'dismissed') => void

/**
 * One transparent, always-on-top window that shows plugin HUD cards and
 * toasts. It never takes focus and lets clicks through except over a card.
 */
class HudHost {
  private huds = new Map<string, HudItem>()
  private toasts: ToastItem[] = []
  private win: BrowserWindow | null = null
  private ready = false
  private hideTimer: NodeJS.Timeout | null = null
  private toastSeq = 0
  onClick: ClickHandler = () => {}

  snapshot(): HudSnapshot {
    return { huds: [...this.huds.values()], toasts: this.toasts }
  }

  hud(pluginId: string, pluginName: string, params: Record<string, unknown>): void {
    const id = String(params.id ?? '')
    const key = `${pluginId}:${id}`
    const op = String(params.op ?? 'update')
    const props = (params.props ?? {}) as Record<string, unknown>
    if (op === 'hide' || op === 'close') {
      this.huds.delete(key)
    } else if (op === 'show' || this.huds.has(key)) {
      const indicator = INDICATORS.includes(props.indicator as HudIndicator) ? (props.indicator as HudIndicator) : 'none'
      this.huds.set(key, {
        key,
        plugin: pluginName,
        title: String(props.title ?? '').slice(0, 200),
        text: String(props.text ?? '').slice(0, 2000),
        indicator,
        level: Math.max(0, Math.min(1, Number(props.level) || 0)),
        position: props.position === 'top' ? 'top' : 'bottom'
      })
    }
    this.push()
  }

  toast(pluginName: string, params: Record<string, unknown>): void {
    const kinds = ['info', 'success', 'warning', 'error'] as const
    const kind = kinds.includes(params.kind as (typeof kinds)[number]) ? (params.kind as ToastItem['kind']) : 'info'
    const item: ToastItem = {
      key: `toast-${++this.toastSeq}`,
      plugin: pluginName,
      message: String(params.message ?? '').slice(0, 500),
      description: params.description ? String(params.description).slice(0, 2000) : undefined,
      kind,
      duration: Math.min(30, Math.max(1, Number(params.duration) || 4))
    }
    this.toasts = [...this.toasts.slice(-3), item]
    setTimeout(() => this.dismiss(item.key), item.duration * 1000)
    this.push()
  }

  dismiss(key: string): void {
    const before = this.toasts.length
    this.toasts = this.toasts.filter((t) => t.key !== key)
    if (this.toasts.length !== before) this.push()
  }

  click(key: string): void {
    const hud = this.huds.get(key)
    if (!hud) return
    const [pluginId, ...rest] = key.split(':')
    this.onClick(pluginId, rest.join(':'), 'click')
  }

  /** Remove everything a plugin showed (it stopped). */
  removePlugin(pluginId: string): void {
    let changed = false
    for (const key of [...this.huds.keys()]) {
      if (key.startsWith(`${pluginId}:`)) {
        this.huds.delete(key)
        changed = true
      }
    }
    if (changed) this.push()
  }

  setInteractive(interactive: boolean): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    if (interactive) win.setIgnoreMouseEvents(false)
    else win.setIgnoreMouseEvents(true, { forward: true })
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      title: 'Llama Run plugin status',
      webPreferences: { ...baseWebPreferences(), spellcheck: false, backgroundThrottling: false }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setIgnoreMouseEvents(true, { forward: true })
    hardenNavigation(win)
    this.ready = false
    win.webContents.once('did-finish-load', () => {
      this.ready = true
      this.push()
    })
    win.on('closed', () => {
      this.win = null
      this.ready = false
    })
    loadPage(win, 'hud')
    this.win = win
    return win
  }

  private place(win: BrowserWindow): void {
    const top = [...this.huds.values()].length > 0 && [...this.huds.values()].every((h) => h.position === 'top')
    const area = screen.getPrimaryDisplay().workArea
    const x = Math.round(area.x + (area.width - WIDTH) / 2)
    const y = top ? area.y + MARGIN : area.y + area.height - HEIGHT - MARGIN
    win.setBounds({ x, y, width: WIDTH, height: HEIGHT })
  }

  private push(): void {
    const empty = this.huds.size === 0 && this.toasts.length === 0
    if (empty && !this.win) return
    const win = this.ensureWindow()
    if (this.ready) win.webContents.send('hud:state', this.snapshot())
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    if (empty) {
      // Let the cards fade out before hiding the window.
      this.hideTimer = setTimeout(() => {
        if (!win.isDestroyed()) win.hide()
      }, 400)
    } else {
      this.place(win)
      if (!win.isVisible()) win.showInactive()
    }
  }

  close(): void {
    this.huds.clear()
    this.toasts = []
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}

export const hudHost = new HudHost()

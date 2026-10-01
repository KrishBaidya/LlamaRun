import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { PluginDialogRequest, UiNode } from '@shared/types'
import { baseWebPreferences, chromeOptions, hardenNavigation, loadPage, materialOptions, trackThemeForTitlebar } from '../../windows/load'

interface Pending {
  request: PluginDialogRequest
  win: BrowserWindow
  pluginId: string
  resolve: (value: unknown) => void
}

const pending = new Map<string, Pending>()

function cancelledValue(kind: PluginDialogRequest['kind']): unknown {
  return kind === 'confirm' ? false : null
}

/** Shows a dialog for a plugin and resolves with the user's answer (false/null if dismissed). */
export function showPluginDialog(plugin: { id: string; name: string; icon?: string }, params: Record<string, unknown>): Promise<unknown> {
  const kind = (['alert', 'confirm', 'form'] as const).find((k) => k === params.kind) ?? 'alert'
  const request: PluginDialogRequest = {
    id: randomUUID(),
    plugin: plugin.name,
    icon: plugin.icon,
    kind,
    title: String(params.title ?? plugin.name).slice(0, 200),
    message: params.message ? String(params.message).slice(0, 4000) : undefined,
    fields: kind === 'form' && Array.isArray(params.fields) ? (params.fields as UiNode[]) : undefined,
    confirmLabel: params.confirmLabel ? String(params.confirmLabel) : undefined,
    cancelLabel: params.cancelLabel ? String(params.cancelLabel) : undefined,
    destructive: !!params.destructive
  }

  const win = new BrowserWindow({
    width: 440,
    height: 220,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: `${plugin.name}: ${request.title}`,
    ...chromeOptions(),
    ...materialOptions('mica'),
    webPreferences: baseWebPreferences()
  })
  hardenNavigation(win)
  trackThemeForTitlebar(win)

  return new Promise((resolve) => {
    pending.set(request.id, { request, win, pluginId: plugin.id, resolve })
    win.on('closed', () => {
      const entry = pending.get(request.id)
      if (entry) {
        pending.delete(request.id)
        entry.resolve(cancelledValue(kind))
      }
    })
    loadPage(win, 'dialog', request.id)
  })
}

export function getDialog(id: string): PluginDialogRequest | null {
  return pending.get(id)?.request ?? null
}

export function resolveDialog(id: string, value: unknown): void {
  const entry = pending.get(id)
  if (!entry) return
  pending.delete(id)
  const { kind } = entry.request
  entry.resolve(kind === 'confirm' ? value === true : kind === 'form' ? (value && typeof value === 'object' ? value : null) : null)
  if (!entry.win.isDestroyed()) entry.win.close()
}

/** The dialog page measured its content: size the window to it and show it. */
export function sizeDialog(id: string, height: number): void {
  const entry = pending.get(id)
  if (!entry || entry.win.isDestroyed()) return
  const h = Math.max(140, Math.min(720, Math.round(height)))
  entry.win.setContentSize(440, h)
  if (!entry.win.isVisible()) {
    entry.win.center()
    entry.win.show()
    entry.win.focus()
  }
}

/** Dismiss a plugin's open dialogs (it stopped). */
export function closePluginDialogs(pluginId: string): void {
  for (const entry of [...pending.values()]) {
    if (entry.pluginId === pluginId && !entry.win.isDestroyed()) entry.win.close()
  }
}

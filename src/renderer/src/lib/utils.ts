import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** The OS this window runs on (works in app windows and in plugin panels). */
export function currentPlatform(): string {
  return window.llamarun?.platform ?? window.llamarunView?.platform ?? 'win32'
}

/** Applies the Windows accent colour and backdrop support to <html>. */
export function applyAppearance(info: { accentColor: string | null; material: boolean; dark?: boolean }): void {
  const root = document.documentElement
  if (info.accentColor) root.style.setProperty('--os-accent', info.accentColor)
  root.classList.toggle('has-material', info.material)
  if (info.dark !== undefined) root.classList.toggle('dark', info.dark)
}

/**
 * Follows the OS light/dark preference and tags <html> with the platform so the
 * Fluent layer (Segoe UI Variable, system accent, translucent surfaces) only
 * applies on Windows.
 */
export function applySystemTheme(): void {
  const root = document.documentElement
  const platform = currentPlatform()
  root.classList.add(platform === 'win32' ? 'platform-win' : platform === 'darwin' ? 'platform-mac' : 'platform-linux')

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (): void => {
    root.classList.toggle('dark', mq.matches)
  }
  apply()
  mq.addEventListener('change', apply)
  if (!window.llamarun) return

  const loadAccent = (): void => void window.llamarun.app.appearance().then(applyAppearance)
  loadAccent()
  // The main process re-broadcasts settings when the Windows accent colour changes.
  window.llamarun.on('settings:changed', loadAccent)
}

export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  // Strip Electron's "Error invoking remote method 'x': Error: " prefix.
  return msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

export function relativeDay(ts: number): string {
  const day = 86_400_000
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  if (ts >= startOfToday) return 'Today'
  if (ts >= startOfToday - day) return 'Yesterday'
  if (ts >= startOfToday - 7 * day) return 'Previous 7 days'
  if (ts >= startOfToday - 30 * day) return 'Previous 30 days'
  return 'Older'
}

export function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

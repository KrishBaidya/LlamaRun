import { dialog, globalShortcut } from 'electron'
import { DEFAULT_HOTKEY, FALLBACK_HOTKEY } from '@shared/constants'
import { analytics } from './analytics'
import { settings } from './settings'
import { toggleOverlay } from './windows/overlay'

let active: string | null = null

export function activeHotkey(): string | null {
  return active
}

function tryRegister(accelerator: string): boolean {
  try {
    return globalShortcut.register(accelerator, () => toggleOverlay('hotkey'))
  } catch {
    return false // invalid accelerator string
  }
}

/**
 * Registers the configured hotkey, falling back to Ctrl+Shift+S when the
 * default is taken by another app (same behaviour as the WinUI app).
 */
export function registerHotkey(showErrors = true): string | null {
  if (active) globalShortcut.unregister(active)
  active = null
  const requested = settings.get('hotkey') || DEFAULT_HOTKEY
  const candidates = [requested, ...(requested === DEFAULT_HOTKEY ? [FALLBACK_HOTKEY] : [])]
  for (const accelerator of candidates) {
    if (tryRegister(accelerator)) {
      active = accelerator
      if (accelerator !== requested) analytics.track('hotkey_fallback_used')
      return active
    }
  }
  analytics.track('hotkey_registration_failed', { custom: requested !== DEFAULT_HOTKEY })
  if (showErrors) {
    dialog.showErrorBox(
      'Llama Run',
      `Failed to register hotkey ${requested}. Another application may be using it; choose a different one in Settings.`
    )
  }
  return null
}

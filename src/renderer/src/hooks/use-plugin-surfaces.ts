import { useSyncExternalStore } from 'react'
import type { PluginSurfaces } from '@shared/types'

const EMPTY: PluginSurfaces = { renderers: [], buttons: [], statusItems: [], attachSources: [], settingsPages: [], toolCards: [] }

let current = EMPTY
let started = false
const listeners = new Set<() => void>()

function set(next: PluginSurfaces): void {
  current = next
  for (const l of listeners) l()
}

function start(): void {
  // Plugin panel windows have no app bridge, and get nothing plugins added.
  if (started || typeof window === 'undefined' || !window.llamarun) return
  started = true
  window.llamarun.on('plugins:surfaces', set)
  void window.llamarun.plugins
    .surfaces()
    .then(set)
    .catch(() => {})
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** What running plugins added to the chat window and Settings (SDK 1.6), kept current. */
export function usePluginSurfaces(): PluginSurfaces {
  start()
  return useSyncExternalStore(subscribe, () => current)
}

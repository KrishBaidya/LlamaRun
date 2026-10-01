// What plugin TSX panels get from `import ... from '@llamarun/plugin'`.
// Keep sdk/ts/llamarun-plugin.d.ts in step with this module.
import { createContext, useContext, useSyncExternalStore } from 'react'

type State = Record<string, unknown>

class PanelStore {
  private state: State = {}
  private listeners = new Set<() => void>()

  get = (): State => this.state
  set(state: State): void {
    this.state = state
    for (const l of this.listeners) l()
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const panelStore = new PanelStore()

export interface PanelInfo {
  pluginId: string
  pluginName: string
  title: string
}

export const PanelContext = createContext<PanelInfo>({ pluginId: '', pluginName: '', title: '' })

const bridge = () => window.llamarunView!

/** The state the plugin shares with this panel (`panel.set_state(...)` in Python). Re-renders when it changes. */
export function usePluginState<T extends object = State>(): T {
  return useSyncExternalStore(panelStore.subscribe, panelStore.get) as T
}

/** Fire-and-forget event to the plugin: runs the handler registered with `panel.on(event)`. */
export function emit(event: string, payload?: unknown): void {
  void bridge()
    .send(event, payload ?? null)
    .catch((err: unknown) => console.error(`[llamarun] ${event} failed:`, err))
}

/** Call a plugin handler and get its return value. Rejects if the handler raises. */
export function call<T = unknown>(event: string, payload?: unknown): Promise<T> {
  return bridge().send(event, payload ?? null) as Promise<T>
}

/** Close this panel window. */
export function close(): void {
  void bridge().close()
}

export function setTitle(title: string): void {
  void bridge().setTitle(title)
}

/** Which plugin and panel this is. */
export function usePanel(): PanelInfo {
  return useContext(PanelContext)
}

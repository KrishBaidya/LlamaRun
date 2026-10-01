import type { LlamaRunApi } from '../shared/ipc'
import type { AppearanceInfo, PluginViewInit, UiNode } from '../shared/types'

/** Bridge available in plugin panel windows only (src/preload/pluginView.ts). */
export interface LlamaRunViewApi {
  platform: string
  init(): Promise<PluginViewInit>
  send(event: string, payload?: unknown, handler?: string): Promise<unknown>
  close(): Promise<void>
  setTitle(title: string): Promise<void>
  onTree(listener: (tree: UiNode) => void): () => void
  onState(listener: (state: Record<string, unknown>) => void): () => void
  onTitle(listener: (title: string) => void): () => void
  onAppearance(listener: (info: AppearanceInfo & { dark: boolean }) => void): () => void
}

declare global {
  interface Window {
    /** App windows. Not present in plugin panels. */
    llamarun: LlamaRunApi
    /** Plugin panel windows only. */
    llamarunView?: LlamaRunViewApi
  }
}

export {}

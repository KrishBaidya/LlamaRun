// Preload for plugin panel windows. Plugin code (TSX) runs in these pages, so
// they get this narrow bridge instead of window.llamarun: they can only talk
// to their own plugin, and only through the main process.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

type Listener = (payload: unknown) => void

function subscribe(channel: string, listener: Listener): () => void {
  const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('llamarunView', {
  platform: process.platform,
  init: () => ipcRenderer.invoke('pluginView:init'),
  /** Send an event to the plugin; resolves with the handler's return value. */
  send: (event: string, payload?: unknown, handler?: string) => ipcRenderer.invoke('pluginView:event', event, payload, handler),
  close: () => ipcRenderer.invoke('pluginView:close'),
  setTitle: (title: string) => ipcRenderer.invoke('pluginView:setTitle', title),
  onTree: (listener: Listener) => subscribe('pluginView:tree', listener),
  onState: (listener: Listener) => subscribe('pluginView:state', listener),
  onTitle: (listener: Listener) => subscribe('pluginView:title', listener),
  onAppearance: (listener: Listener) => subscribe('pluginView:appearance', listener)
})

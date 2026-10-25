import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type LlamaRunApi } from '@shared/ipc'

const api: Record<string, unknown> = {
  platform: process.platform,
  files: { pathFor: (file: File) => webUtils.getPathForFile(file) },
  on(channel: string, listener: (payload: unknown) => void) {
    if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(`Unknown event channel: ${channel}`)
    }
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

for (const channel of INVOKE_CHANNELS) {
  const [ns, method] = channel.split(':')
  const target = (api[ns] ??= {}) as Record<string, unknown>
  target[method] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
}

contextBridge.exposeInMainWorld('llamarun', api as unknown as LlamaRunApi)

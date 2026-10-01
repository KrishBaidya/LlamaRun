import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Directory holding bundled, non-asar resources (python/, sdk/, icons). */
export function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

export function iconPath(name = 'icon.png'): string {
  return join(resourcesDir(), name)
}

export function sdkDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'sdk') : join(app.getAppPath(), 'sdk', 'python')
}

export function pythonPlatformDir(): string {
  const os = ({ win32: 'win', darwin: 'mac' } as Record<string, string>)[process.platform] ?? process.platform
  return `${os}-${process.arch}`
}

/**
 * Path to the bundled interpreter. Falls back to LLAMARUN_PYTHON for
 * developers who have not run `npm run fetch-python` yet.
 */
export function pythonExecutable(): string {
  const root = join(resourcesDir(), 'python', pythonPlatformDir())
  const candidate =
    process.platform === 'win32' ? join(root, 'python.exe') : join(root, 'bin', 'python3')
  if (existsSync(candidate)) return candidate
  return process.env.LLAMARUN_PYTHON ?? candidate
}

export const userDataPath = (...parts: string[]): string => join(app.getPath('userData'), ...parts)
export const pluginsDir = (): string => userDataPath('Plugins')
export const pluginDataDir = (): string => userDataPath('PluginData')
export const mcpConfigPath = (): string => userDataPath('mcp.json')
export const logsDir = (): string => userDataPath('logs')

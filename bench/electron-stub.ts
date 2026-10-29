/**
 * Just enough of Electron for Llama Run's main-process modules to run in
 * plain Node during benchmarks: settings go to a temporary folder, and the
 * approval dialog answers "Allow once" (benchmarks run unattended).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-bench-'))

export const app = {
  getPath: () => userData,
  getAppPath: () => process.cwd(),
  getVersion: () => 'bench',
  isPackaged: false
}

export const dialog = { showMessageBox: async () => ({ response: 0 }) }
export class BrowserWindow {
  static getFocusedWindow(): null {
    return null
  }
}
export const globalShortcut = { register: () => true, unregister: () => undefined }
export const screen = {}
export const nativeTheme = { shouldUseDarkColors: false, on: () => undefined }
export const systemPreferences = { getAccentColor: () => '0b7a80ff', on: () => undefined }
export const safeStorage = { isEncryptionAvailable: () => false }
export const shell = {}
export const utilityProcess = {}
export class Notification {}
export default { app, dialog, BrowserWindow, globalShortcut, screen, nativeTheme, systemPreferences, safeStorage, shell, utilityProcess, Notification }

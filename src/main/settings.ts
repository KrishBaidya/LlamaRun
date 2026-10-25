import { EventEmitter } from 'node:events'
import type { Settings } from '@shared/types'
import { DEFAULT_HOTKEY } from '@shared/constants'
import { readJson, writeJson } from './jsonFile'
import { userDataPath } from './paths'

export const DEFAULT_SETTINGS: Settings = {
  isFirstRun: true,
  selectedModel: '',
  appOpacity: 15,
  startupEnabled: false,
  hotkey: DEFAULT_HOTKEY,
  pluginsEnabled: {},
  pluginGrants: {},
  pluginLinks: {},
  windowWidthPct: 50,
  windowHeightPct: 50,
  overlayNewChatAfterMinutes: 30,
  memoryEnabled: true,
  skillsEnabled: true,
  skillsDisabled: {},
  skillsTrusted: {},
  allowedCommands: [],
  autoCompact: true,
  autoCompactPercent: 80,
  compactKeepTurns: 4,
  modelContext: {}
}

class SettingsStore extends EventEmitter<{ changed: [Settings, Partial<Settings>] }> {
  private data: Settings | null = null

  private get path(): string {
    return userDataPath('config.json')
  }

  get all(): Settings {
    this.data ??= { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(this.path, {}) }
    return this.data
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.all[key]
  }

  set(patch: Partial<Settings>): Settings {
    this.data = { ...this.all, ...patch }
    writeJson(this.path, this.data)
    this.emit('changed', this.data, patch)
    return this.data
  }

  /** Restores defaults for user-facing preferences; onboarding state and plugin choices are kept. */
  reset(): Settings {
    const { isFirstRun, pluginsEnabled, pluginGrants, pluginLinks, skillsDisabled, skillsTrusted, modelContext } = this.all
    return this.set({ ...DEFAULT_SETTINGS, isFirstRun, pluginsEnabled, pluginGrants, pluginLinks, skillsDisabled, skillsTrusted, modelContext })
  }
}

export const settings = new SettingsStore()

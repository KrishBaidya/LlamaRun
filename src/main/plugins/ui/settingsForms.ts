import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { PluginSettingsView, UiNode } from '@shared/types'
import { readJson, writeJson } from '../../jsonFile'
import { pluginDataDir } from '../../paths'

type Values = Record<string, unknown>

function walk(nodes: UiNode[], fn: (n: UiNode) => void): void {
  for (const n of nodes) {
    fn(n)
    if (n.children) walk(n.children, fn)
  }
}

/** Field names declared in a schema and their defaults. */
export function fieldDefaults(schema: UiNode[]): Values {
  const out: Values = {}
  walk(schema, (n) => {
    const name = n.props?.name
    if (typeof name === 'string') out[name] = n.props?.default ?? null
  })
  return out
}

/**
 * Settings forms that plugins declare with ui.settings(). The app owns the
 * values (PluginData/<module>/settings.json) so they survive updates and can
 * be edited while the plugin is busy.
 */
class PluginSettingsForms extends EventEmitter<{ changed: [string] }> {
  private schemas = new Map<string, UiNode[]>()

  private path(module: string): string {
    return join(pluginDataDir(), module, 'settings.json')
  }

  values(module: string): Values {
    return readJson<Values>(this.path(module), {})
  }

  register(pluginId: string, module: string, schema: UiNode[]): Values {
    this.schemas.set(pluginId, schema)
    this.emit('changed', pluginId)
    return this.values(module)
  }

  /** Values set by the plugin itself (llamarun.settings.set). */
  setFromPlugin(pluginId: string, module: string, patch: Values): void {
    writeJson(this.path(module), { ...this.values(module), ...patch })
    this.emit('changed', pluginId)
  }

  /** Values saved by the user. Returns the keys that actually changed. */
  save(pluginId: string, module: string, patch: Values): Values {
    const schema = this.schemas.get(pluginId)
    const known = schema ? fieldDefaults(schema) : {}
    const current = { ...known, ...this.values(module) }
    const changed: Values = {}
    for (const [key, value] of Object.entries(patch)) {
      if (schema && !(key in known)) continue
      if (JSON.stringify(current[key]) !== JSON.stringify(value)) changed[key] = value
    }
    if (Object.keys(changed).length) {
      writeJson(this.path(module), { ...this.values(module), ...changed })
      this.emit('changed', pluginId)
    }
    return changed
  }

  forget(pluginId: string): void {
    if (this.schemas.delete(pluginId)) this.emit('changed', pluginId)
  }

  has(pluginId: string): boolean {
    return this.schemas.has(pluginId)
  }

  view(pluginId: string, module: string): PluginSettingsView {
    const schema = this.schemas.get(pluginId) ?? null
    return { pluginId, schema, values: { ...(schema ? fieldDefaults(schema) : {}), ...this.values(module) } }
  }
}

export const pluginSettings = new PluginSettingsForms()

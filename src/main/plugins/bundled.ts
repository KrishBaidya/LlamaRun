import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from '../jsonFile'
import { pluginsDir, resourcesDir, userDataPath } from '../paths'
import { settings } from '../settings'
import { pluginHost } from './host'
import { installRequirements } from './install'
import { readManifest } from './manifest'

/**
 * Plugins shipped inside the installer (resources/plugins, staged by
 * scripts/bundle-plugins.mjs) without their pip requirements. On first launch
 * each one is set up in PluginSetup/<id>, its requirements are installed in the
 * background, and only then is it moved into Plugins/. A failed setup (offline)
 * is retried on the next launch; a plugin the user later removes is not put back.
 */

/** Bundled plugins approved up front. The rest (EDITH uses the microphone) wait for consent in Settings → Plugins. */
const AUTO_GRANT = new Set(['plugin_creator'])

const seededPath = (): string => userDataPath('bundled-plugins.json')

let running: Promise<void> | null = null

export function installBundledPlugins(): Promise<void> {
  running ??= setUpAll().finally(() => (running = null))
  return running
}

async function setUpAll(): Promise<void> {
  const source = join(resourcesDir(), 'plugins')
  if (!existsSync(source)) return
  const seeded = new Set(readJson<string[]>(seededPath(), []))

  // In parallel, so a plugin with nothing to install is not held up by another's pip download.
  const pending = readdirSync(source).filter((id) => !seeded.has(id) && existsSync(join(source, id, 'plugin.json')))
  await Promise.all(
    pending.map(async (id) => {
      if (!existsSync(join(pluginsDir(), id))) {
        try {
          await setUp(id, join(source, id))
        } catch (err) {
          pluginHost.log('error', `Could not set up bundled plugin ${id}; will retry next launch: ${(err as Error).message}`)
          return
        }
      }
      seeded.add(id)
      writeJson(seededPath(), [...seeded])
    })
  )
}

async function setUp(id: string, source: string): Promise<void> {
  const staging = userDataPath('PluginSetup', id)
  rmSync(staging, { recursive: true, force: true })
  cpSync(source, staging, { recursive: true })
  try {
    pluginHost.log('info', `Setting up bundled plugin ${id}`)
    await installRequirements(staging)
    mkdirSync(pluginsDir(), { recursive: true })
    renameSync(staging, join(pluginsDir(), id))
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  if (AUTO_GRANT.has(id)) {
    const permissions = readManifest(join(pluginsDir(), id)).permissions
    settings.set({ pluginGrants: { ...settings.get('pluginGrants'), [id]: permissions } })
  }
  await pluginHost.adopt(id)
}

// Stages the plugins that ship inside the installer into bundled-plugins/<id>/.
// Only their code is shipped: electron-builder copies the folder to
// resources/plugins, and src/main/plugins/bundled.ts installs each plugin's pip
// requirements on first launch.
//
//   node scripts/bundle-plugins.mjs [--from <Plugins folder>]
//
// --from defaults to the dev install's Plugins folder (%APPDATA%\Llama Run\Plugins).
import { cpSync, existsSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGINS = ['plugin_creator', 'edith']
const SKIP = new Set(['__pycache__', '.deps', '.git', '.venv', 'node_modules', 'tests', '.pytest_cache'])

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const fromArg = args.indexOf('--from')
const from = fromArg >= 0 ? args[fromArg + 1] : join(process.env.APPDATA ?? '', 'Llama Run', 'Plugins')
const out = join(root, 'bundled-plugins')

rmSync(out, { recursive: true, force: true })
for (const id of PLUGINS) {
  const src = join(from, id)
  if (!existsSync(join(src, 'plugin.json'))) {
    console.error(`[bundle-plugins] ${id}: no plugin.json in ${src}`)
    process.exit(1)
  }
  cpSync(src, join(out, id), { recursive: true, filter: (p) => !SKIP.has(basename(p)) })
  console.log(`[bundle-plugins] ${id}: staged`)
}

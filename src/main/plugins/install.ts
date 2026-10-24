import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { PluginInspection, PluginPermission } from '@shared/types'
import { pluginsDir, pythonExecutable } from '../paths'
import { settings } from '../settings'
import { readManifest } from './manifest'
import { describePermissions } from './permissions'

const SKIP = new Set(['__pycache__', '.deps', '.git', '.venv', 'node_modules'])

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONNOUSERSITE: '1' } })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (out += d))
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(out.trim() || `exit code ${code}`))))
  })
}

/**
 * Installs pip requirements into <plugin>/.deps with the bundled interpreter,
 * which the plugin host adds to sys.path. Only prebuilt wheels are accepted,
 * so installing a plugin never runs a package's build scripts.
 */
export async function installRequirements(folder: string): Promise<void> {
  const req = join(folder, 'requirements.txt')
  if (!existsSync(req)) return
  try {
    await run(pythonExecutable(), [
      '-s',
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '--no-input',
      '--upgrade',
      '--only-binary=:all:',
      '--target',
      join(folder, '.deps'),
      '-r',
      req
    ])
  } catch (err) {
    const message = (err as Error).message
    throw new Error(
      /no matching distribution|could not find a version/i.test(message)
        ? `A requirement has no prebuilt wheel for Python 3.13 on this platform (source builds are disabled for safety):\n${message.split('\n').slice(-3).join('\n')}`
        : message
    )
  }
}

/** Extracts a .zip (using the bundled Python's zipfile module) and returns the plugin root inside it. */
async function extract(zipPath: string): Promise<{ tmp: string; root: string }> {
  const tmp = mkdtempSync(join(tmpdir(), 'llamarun-plugin-'))
  await run(pythonExecutable(), ['-s', '-m', 'zipfile', '-e', zipPath, tmp])
  let root = tmp
  if (!existsSync(join(tmp, 'plugin.json'))) {
    const dirs = readdirSync(tmp).filter((d) => statSync(join(tmp, d)).isDirectory())
    if (dirs.length === 1) root = join(tmp, dirs[0])
  }
  return { tmp, root }
}

function idFor(kind: PluginInspection['kind'], source: string, root: string, tmp?: string): string {
  const raw = kind === 'zip' && root === tmp ? basename(source).replace(/\.zip$/i, '') : basename(root)
  return raw.replace(/[^A-Za-z0-9_.-]/g, '_')
}

/** Sources the user picked and reviewed; only these can be installed. */
const inspected = new Map<string, PluginInspection>()

/** Reads a plugin folder or .zip without installing it, for the permission prompt. */
export async function inspectPlugin(source: string, kind: PluginInspection['kind']): Promise<PluginInspection> {
  let tmp: string | undefined
  let root = source
  try {
    if (kind === 'zip') ({ tmp, root } = await extract(source))
    const manifest = readManifest(root)
    const id = idFor(kind, source, root, tmp)
    const grants = settings.get('pluginGrants')[id]
    const installedFolder = kind === 'link' ? settings.get('pluginLinks')[id] : join(pluginsDir(), id)
    let existing: PluginInspection['existing']
    if (grants && installedFolder && existsSync(installedFolder)) {
      try {
        existing = { version: readManifest(installedFolder).version, granted: grants }
      } catch {
        existing = { version: '', granted: grants }
      }
    }
    const inspection: PluginInspection = {
      source,
      kind,
      id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      description: manifest.description,
      sdkVersion: manifest.sdkVersion,
      permissions: describePermissions(manifest.permissions),
      existing,
      hasRequirements: existsSync(join(root, 'requirements.txt'))
    }
    inspected.set(`${kind}:${source}`, inspection)
    return inspection
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * Installs (copies, extracts or links) a plugin the user reviewed, with the
 * permissions they approved. Returns the plugin id.
 */
export async function installPlugin(source: string, kind: PluginInspection['kind'], approved: PluginPermission[]): Promise<string> {
  const inspection = inspected.get(`${kind}:${source}`)
  if (!inspection) throw new Error('Review the plugin before installing it')
  inspected.delete(`${kind}:${source}`)

  let id: string
  if (kind === 'link') {
    const manifest = readManifest(source)
    id = inspection.id
    await installRequirements(source)
    settings.set({ pluginLinks: { ...settings.get('pluginLinks'), [id]: source } })
    approved = approved.filter((p) => manifest.permissions.includes(p))
  } else {
    let tmp: string | undefined
    let root = source
    try {
      if (kind === 'zip') ({ tmp, root } = await extract(source))
      const manifest = readManifest(root)
      id = idFor(kind, source, root, tmp)
      const dest = join(pluginsDir(), id)
      rmSync(dest, { recursive: true, force: true })
      cpSync(root, dest, { recursive: true, filter: (src) => !SKIP.has(basename(src)) })
      await installRequirements(dest)
      approved = approved.filter((p) => manifest.permissions.includes(p))
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true })
    }
  }
  settings.set({ pluginGrants: { ...settings.get('pluginGrants'), [id]: approved } })
  return id
}

/** Deletes the plugin folder. PluginData/<module> (storage, settings, logs) is kept. */
export function removePluginFolder(id: string): void {
  if (!id || id.includes('/') || id.includes('\\') || id === '..' || id === '.') {
    throw new Error(`Invalid plugin id: ${id}`)
  }
  rmSync(join(pluginsDir(), id), { recursive: true, force: true })
}

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { PluginPermission } from '@shared/types'
import { isPermission } from './permissions'

/** SDK version this app provides. Keep in sync with llamarun.__version__. */
export const SDK_VERSION = '1.4'

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/
const versionRange = /^\s*(>=|>|<=|<|==|=|\^|~)?\s*\d+(\.\d+){0,2}\s*$/

const text = (field: string) =>
  z.string({ error: `"${field}" is required and must be a non-empty string` }).trim().min(1, `"${field}" must not be empty`)

const schema = z.object({
  name: text('name'),
  description: text('description'),
  version: text('version'),
  author: text('author'),
  sdk_version: text('sdk_version'),
  entry: z.object(
    {
      module: z.string().regex(identifier, '"entry.module" must be a valid Python identifier'),
      class: z.string().regex(identifier, '"entry.class" must be a valid Python identifier')
    },
    { error: '"entry" is required and must be an object with "module" and "class"' }
  ),
  actions: z.record(z.string(), z.string().regex(identifier, 'action methods must be Python identifiers')).optional(),
  permissions: z.array(z.string()).optional(),
  dependencies: z
    .record(z.string().regex(identifier, 'dependency names must be module names'), z.string().regex(versionRange, 'use a version like ">=1.0"'))
    .optional(),
  shared: z.object({ writers: z.array(z.string()).optional() }).optional(),
  ui: z
    .object({
      panels: z
        .record(z.string().regex(identifier, 'panel names must be identifiers'), z.string().regex(/\.(tsx|jsx|ts|js)$/, 'panel files must be .tsx, .jsx, .ts or .js'))
        .optional()
    })
    .optional()
})

export interface PluginManifest {
  name: string
  description: string
  version: string
  author: string
  sdkVersion: string
  module: string
  className: string
  actions: Record<string, string>
  /** ['unrestricted'] for legacy manifests without a "permissions" field. */
  permissions: PluginPermission[]
  legacy: boolean
  dependencies: Record<string, string>
  sharedWriters: string[]
  panels: Record<string, string>
}

export class ManifestError extends Error {}

/** Compatible when majors match and the plugin's minor is not newer than ours. */
export function checkSdkVersion(wanted: string, host = SDK_VERSION): void {
  const parse = (v: string): [number, number] => {
    const [major, minor = '0'] = v.split('.')
    return [Number(major), Number(minor)]
  }
  const [wMajor, wMinor] = parse(wanted)
  const [hMajor, hMinor] = parse(host)
  if (!Number.isInteger(wMajor) || !Number.isInteger(wMinor)) {
    throw new ManifestError(`"sdk_version" must look like "1.1", got "${wanted}"`)
  }
  if (wMajor !== hMajor || wMinor > hMinor) {
    throw new ManifestError(`plugin targets SDK ${wanted}, but this Llama Run provides SDK ${host}`)
  }
}

export function validateManifest(data: unknown): PluginManifest {
  const result = schema.safeParse(data)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue.path.join('.')
    const message = issue.message.startsWith('"') || !path ? issue.message : `"${path}": ${issue.message}`
    throw new ManifestError(`plugin.json: ${message}`)
  }
  const m = result.data
  checkSdkVersion(m.sdk_version)
  const unknown = (m.permissions ?? []).filter((p) => !isPermission(p) || p === 'unrestricted')
  if (unknown.length) {
    throw new ManifestError(`plugin.json: unknown permission${unknown.length > 1 ? 's' : ''} ${unknown.map((p) => `"${p}"`).join(', ')}`)
  }
  const legacy = m.permissions === undefined
  if (legacy && m.sdk_version.split('.')[1] !== '0') {
    throw new ManifestError('plugin.json: "permissions" is required from SDK 1.1 (use [] if the plugin needs none)')
  }
  return {
    name: m.name,
    description: m.description,
    version: m.version,
    author: m.author,
    sdkVersion: m.sdk_version,
    module: m.entry.module,
    className: m.entry.class,
    actions: m.actions ?? {},
    permissions: legacy ? ['unrestricted'] : ([...new Set(m.permissions)] as PluginPermission[]),
    legacy,
    dependencies: m.dependencies ?? {},
    sharedWriters: m.shared?.writers ?? [],
    panels: m.ui?.panels ?? {}
  }
}

export function readManifest(folder: string): PluginManifest {
  const path = join(folder, 'plugin.json')
  if (!existsSync(path)) throw new ManifestError(`No plugin.json found in ${folder}`)
  let data: unknown
  try {
    data = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''))
  } catch (err) {
    throw new ManifestError(`plugin.json is not valid JSON: ${(err as Error).message}`)
  }
  return validateManifest(data)
}

/** Does `version` satisfy a range like ">=1.2", "^1.0", "1.4"? */
export function satisfies(version: string, range: string): boolean {
  const match = /^\s*(>=|>|<=|<|==|=|\^|~)?\s*(.+?)\s*$/.exec(range)
  if (!match) return false
  const [, op = '>=', want] = match
  const nums = (v: string): number[] => v.split(/[.+-]/).slice(0, 3).map((p) => Number.parseInt(p, 10) || 0)
  const a = nums(version)
  const b = nums(want)
  while (a.length < 3) a.push(0)
  while (b.length < 3) b.push(0)
  const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  switch (op) {
    case '>':
      return cmp > 0
    case '<':
      return cmp < 0
    case '<=':
      return cmp <= 0
    case '=':
    case '==':
      return cmp === 0
    case '^':
      return a[0] === b[0] && cmp >= 0
    case '~':
      return a[0] === b[0] && a[1] === b[1] && cmp >= 0
    default:
      return cmp >= 0
  }
}

export interface OrderInput {
  id: string
  module: string
  dependencies: Record<string, string>
}

/**
 * Orders plugins so dependencies come first, ties broken by module name (the
 * pre-1.1 order). Returns the order and, per plugin id, why it can't run
 * (a missing dependency or a cycle).
 */
export function orderPlugins<T extends OrderInput>(plugins: T[], versions: Record<string, string>): { order: T[]; problems: Map<string, string> } {
  const byModule = new Map(plugins.map((p) => [p.module, p]))
  const problems = new Map<string, string>()
  for (const p of plugins) {
    for (const [dep, range] of Object.entries(p.dependencies)) {
      if (!byModule.has(dep)) problems.set(p.id, `Requires the "${dep}" plugin (${range.trim()}), which isn't installed`)
      else if (versions[dep] && !satisfies(versions[dep], range)) {
        problems.set(p.id, `Requires "${dep}" ${range.trim()}, but version ${versions[dep]} is installed`)
      }
    }
  }
  const order: T[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const sorted = [...plugins].sort((a, b) => a.module.localeCompare(b.module) || a.id.localeCompare(b.id))
  const visit = (p: T, stack: string[]): void => {
    const s = state.get(p.module)
    if (s === 'done') return
    if (s === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(p.module)), p.module].join(' → ')
      for (const m of stack.slice(stack.indexOf(p.module))) {
        const q = byModule.get(m)
        if (q) problems.set(q.id, `Dependency cycle: ${cycle}`)
      }
      return
    }
    state.set(p.module, 'visiting')
    for (const dep of Object.keys(p.dependencies).sort()) {
      const q = byModule.get(dep)
      if (q) visit(q, [...stack, p.module])
    }
    state.set(p.module, 'done')
    order.push(p)
  }
  for (const p of sorted) visit(p, [])
  return { order, problems }
}

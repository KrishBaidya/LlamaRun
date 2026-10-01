import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.', getVersion: () => '0' } }))

const { checkSdkVersion, orderPlugins, satisfies, validateManifest } = await import('../src/main/plugins/manifest')
const { effectiveGrants, allows } = await import('../src/main/plugins/permissions')
const { Broker, SharedStore, topicMatches } = await import('../src/main/plugins/broker')
const { pluginEnv } = await import('../src/main/plugins/process')

const base = {
  name: 'P',
  description: 'd',
  version: '1.2.0',
  author: 'a',
  sdk_version: '1.1',
  entry: { module: 'mod_p', class: 'P' },
  permissions: ['hooks', 'network']
}

const tmp = mkdtempSync(join(tmpdir(), 'llamarun-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('manifest', () => {
  it('parses permissions, dependencies and panels', () => {
    const m = validateManifest({ ...base, dependencies: { other: '>=1.0' }, ui: { panels: { History: 'ui/History.tsx' } }, shared: { writers: ['*'] } })
    expect(m.permissions).toEqual(['hooks', 'network'])
    expect(m.legacy).toBe(false)
    expect(m.dependencies).toEqual({ other: '>=1.0' })
    expect(m.panels).toEqual({ History: 'ui/History.tsx' })
    expect(m.sharedWriters).toEqual(['*'])
  })

  it('treats 1.0 manifests without permissions as unrestricted legacy plugins', () => {
    const { permissions: _p, ...legacy } = base
    const m = validateManifest({ ...legacy, sdk_version: '1.0' })
    expect(m.legacy).toBe(true)
    expect(m.permissions).toEqual(['unrestricted'])
    expect(() => validateManifest({ ...legacy })).toThrow(/"permissions" is required from SDK 1.1/)
  })

  it('reports precise errors', () => {
    expect(() => validateManifest({ ...base, permissions: ['network', 'teleport'] })).toThrow(/unknown permission "teleport"/)
    expect(() => validateManifest({ ...base, permissions: ['unrestricted'] })).toThrow(/unknown permission/)
    expect(() => validateManifest({ ...base, entry: { module: 'bad-name', class: 'P' } })).toThrow(/entry.module/)
    expect(() => validateManifest({ ...base, description: undefined })).toThrow(/"description"/)
    expect(() => validateManifest({ ...base, ui: { panels: { X: 'ui/x.py' } } })).toThrow(/panel files/)
  })

  it('checks SDK compatibility', () => {
    expect(() => checkSdkVersion('1.0', '1.1')).not.toThrow()
    expect(() => checkSdkVersion('1.2', '1.1')).toThrow(/SDK 1.2/)
    expect(() => checkSdkVersion('2.0', '1.1')).toThrow()
  })

  it('compares version ranges', () => {
    expect(satisfies('1.4.0', '>=1.2')).toBe(true)
    expect(satisfies('1.1.9', '>=1.2')).toBe(false)
    expect(satisfies('1.9.0', '^1.2')).toBe(true)
    expect(satisfies('2.0.0', '^1.2')).toBe(false)
    expect(satisfies('1.2.5', '~1.2')).toBe(true)
    expect(satisfies('1.3.0', '1.3')).toBe(true)
  })
})

describe('orderPlugins', () => {
  const p = (id: string, module: string, dependencies: Record<string, string> = {}) => ({ id, module, dependencies })

  it('puts dependencies first, otherwise sorts by module', () => {
    const { order, problems } = orderPlugins([p('c', 'c_mod', { a_mod: '>=1' }), p('z', 'z_mod'), p('a', 'a_mod', { z_mod: '>=1' })], {
      a_mod: '1.0',
      z_mod: '1.0',
      c_mod: '1.0'
    })
    expect(order.map((x) => x.module)).toEqual(['z_mod', 'a_mod', 'c_mod'])
    expect(problems.size).toBe(0)
  })

  it('reports missing, too-old and circular dependencies', () => {
    const { problems } = orderPlugins(
      [p('a', 'a_mod', { missing: '>=1' }), p('b', 'b_mod', { c_mod: '>=2' }), p('c', 'c_mod'), p('x', 'x_mod', { y_mod: '>=0' }), p('y', 'y_mod', { x_mod: '>=0' })],
      { b_mod: '1.0', c_mod: '1.5', x_mod: '1', y_mod: '1' }
    )
    expect(problems.get('a')).toMatch(/isn't installed/)
    expect(problems.get('b')).toMatch(/version 1.5/)
    expect(problems.get('x')).toMatch(/cycle/)
    expect(problems.get('y')).toMatch(/cycle/)
    expect(problems.has('c')).toBe(false)
  })
})

describe('permissions', () => {
  it('grants only what was requested and approved', () => {
    expect(effectiveGrants(['hooks', 'network', 'llm'], ['network', 'llm', 'subprocess'])).toEqual(['network', 'llm'])
    expect(effectiveGrants(['hooks'], undefined)).toEqual([])
    expect(allows(['unrestricted'], 'native')).toBe(true)
    expect(allows(['llm'], 'mcp')).toBe(false)
  })

  it('gives sandboxed plugins a minimal environment inside their data folder', () => {
    process.env.SECRET_TOKEN = 'x'
    const env = pluginEnv(['network'], join(tmp, 'data'))
    expect(env.SECRET_TOKEN).toBeUndefined()
    expect(env.USERPROFILE).toBe(join(tmp, 'data', 'home'))
    expect(env.TEMP).toBe(join(tmp, 'data', 'tmp'))
    expect(pluginEnv(['filesystem'], join(tmp, 'data')).SECRET_TOKEN).toBe('x')
    delete process.env.SECRET_TOKEN
  })
})

describe('broker', () => {
  type Req = { method: string; params: Record<string, unknown> }
  const fakeProcess = (log: Req[], reply: unknown = 'ok') => ({
    running: true,
    request: async (method: string, params: Record<string, unknown>) => {
      log.push({ method, params })
      return reply
    }
  })
  const peer = (module: string, extra: Record<string, unknown> = {}, log: Req[] = []) => ({
    id: module,
    module,
    name: module.toUpperCase(),
    dependencies: {},
    sharedWriters: [],
    services: [],
    subscriptions: [],
    process: fakeProcess(log) as never,
    ...extra
  })

  it('routes service calls only to declared dependencies', async () => {
    const calls: Req[] = []
    const jarvis = peer('jarvis', { services: ['speak'] }, calls)
    const caller = peer('caller', { dependencies: { jarvis: '>=1' } })
    const stranger = peer('stranger')
    const broker = new Broker(() => [jarvis, caller, stranger], new SharedStore(() => join(tmp, 'shared1')))
    await expect(broker.callService(caller, { plugin: 'jarvis', method: 'speak', args: ['hi'] })).resolves.toBe('ok')
    expect(calls[0]).toMatchObject({ method: 'services.call', params: { method: 'speak', args: ['hi'], caller: 'caller' } })
    await expect(broker.callService(stranger, { plugin: 'jarvis', method: 'speak' })).rejects.toThrow(/dependencies/)
    await expect(broker.callService(caller, { plugin: 'jarvis', method: 'shutdown' })).rejects.toThrow(/doesn't expose/)
  })

  it('delivers events to dependents that subscribed', () => {
    const got: Req[] = []
    const other: Req[] = []
    const source = peer('jarvis')
    const listener = peer('listener', { dependencies: { jarvis: '>=1' }, subscriptions: ['jarvis.*'] }, got)
    const notDependent = peer('nosy', { subscriptions: ['*'] }, other)
    const broker = new Broker(() => [source, listener, notDependent], new SharedStore(() => join(tmp, 'shared2')))
    expect(broker.publish(source, 'heard', { text: 'hi' })).toBe(1)
    expect(got[0].params).toEqual({ topic: 'jarvis.heard', data: { text: 'hi' }, source: 'jarvis' })
    expect(other).toHaveLength(0)
    expect(broker.publish('app', 'chat.completed', {})).toBe(1)
    expect(topicMatches('a.*', 'a.b.c')).toBe(true)
    expect(topicMatches('a.b', 'a.bc')).toBe(false)
  })

  it('enforces shared-state ownership and compare-and-set', () => {
    const watcher: Req[] = []
    const owner = peer('stats', { sharedWriters: ['writer'] })
    const writer = peer('writer', { dependencies: { stats: '>=1' } }, watcher)
    const reader = peer('reader', { dependencies: { stats: '>=1' } })
    const broker = new Broker(() => [owner, writer, reader], new SharedStore(() => join(tmp, 'shared3')))
    expect(broker.sharedRequest(owner, 'shared.set', { key: 'n', value: 1 })).toEqual({ ok: true, version: 1 })
    broker.sharedRequest(writer, 'shared.watch', { namespace: 'stats' })
    expect(broker.sharedRequest(writer, 'shared.set', { namespace: 'stats', key: 'n', value: 2, ifVersion: 1 })).toEqual({ ok: true, version: 2 })
    expect(broker.sharedRequest(writer, 'shared.set', { namespace: 'stats', key: 'n', value: 3, ifVersion: 1 })).toEqual({ ok: false, version: 2 })
    expect(broker.sharedRequest(reader, 'shared.get', { namespace: 'stats', key: 'n' })).toEqual({ value: 2, version: 2 })
    expect(() => broker.sharedRequest(reader, 'shared.set', { namespace: 'stats', key: 'n', value: 9 })).toThrow(/can't write/)
    expect(watcher.some((r) => r.params.topic === '$shared.stats')).toBe(true)
    // survives a restart
    expect(new SharedStore(() => join(tmp, 'shared3')).get('stats', 'n')).toEqual({ value: 2, version: 2 })
  })
})

describe('compilePanel', () => {
  it('bundles TSX against the panel globals and rejects other imports', async () => {
    vi.doMock('../src/renderer/src/theme-inline.css?raw', () => ({ default: '@theme inline { --color-primary: var(--primary); }' }))
    const { compilePanel } = await import('../src/main/plugins/ui/compile')
    const folder = join(tmp, 'plugin')
    mkdirSync(join(folder, 'ui'), { recursive: true })
    writeFileSync(join(folder, 'ui', 'util.ts'), 'export const label = (n: number): string => `Count ${n}`\n')
    writeFileSync(
      join(folder, 'ui', 'Panel.tsx'),
      `import { Button } from '@llamarun/ui'\nimport { usePluginState, emit } from '@llamarun/plugin'\nimport { label } from './util'\n` +
        `export default function Panel() {\n  const { n } = usePluginState<{ n: number }>()\n  return <Button className="grid-cols-3 bg-primary" onClick={() => emit('inc')}>{label(n)}</Button>\n}\n`
    )
    const out = await compilePanel(folder, 'ui/Panel.tsx', join(tmp, 'cache'))
    expect(out.js).toContain('window.__llamarun["@llamarun/ui"]')
    expect(out.js).toContain('Count ')
    expect(out.css).toContain('.grid-cols-3')
    expect(out.css).toContain('var(--primary)')
    const again = await compilePanel(folder, 'ui/Panel.tsx', join(tmp, 'cache'))
    expect(again.js).toBe(out.js)

    writeFileSync(join(folder, 'ui', 'Bad.tsx'), `import fs from 'node:fs'\nexport default () => <div>{String(fs)}</div>\n`)
    await expect(compilePanel(folder, 'ui/Bad.tsx', join(tmp, 'cache'))).rejects.toThrow(/can't be imported in a Llama Run panel/)
    await expect(compilePanel(folder, '../outside.tsx', join(tmp, 'cache'))).rejects.toThrow(/outside the plugin folder/)
  }, 60_000)
})

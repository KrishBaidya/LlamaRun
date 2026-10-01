import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from '../jsonFile'
import { pluginDataDir } from '../paths'
import type { PluginProcess } from './process'

/** What the broker needs to know about a plugin. */
export interface BrokerPeer {
  id: string
  module: string
  name: string
  dependencies: Record<string, string>
  sharedWriters: string[]
  process: PluginProcess | null
  services: string[]
  subscriptions: string[]
}

export class BrokerError extends Error {}

const SERVICE_TIMEOUT_MS = 60_000

export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === '*' || pattern === topic) return true
  return pattern.endsWith('.*') && topic.startsWith(pattern.slice(0, -1))
}

interface SharedEntry {
  value: unknown
  version: number
}

/**
 * Key/value namespaces shared between plugins, one per owning module, saved
 * in PluginData/_shared/<module>.json. Every key carries a version so
 * writers can do compare-and-set.
 */
export class SharedStore {
  private data = new Map<string, Record<string, SharedEntry>>()

  constructor(private dir: () => string = () => join(pluginDataDir(), '_shared')) {}

  private ns(owner: string): Record<string, SharedEntry> {
    let entries = this.data.get(owner)
    if (!entries) {
      entries = readJson<Record<string, SharedEntry>>(join(this.dir(), `${owner}.json`), {})
      this.data.set(owner, entries)
    }
    return entries
  }

  private save(owner: string): void {
    mkdirSync(this.dir(), { recursive: true })
    writeJson(join(this.dir(), `${owner}.json`), this.ns(owner))
  }

  get(owner: string, key: string): SharedEntry {
    return this.ns(owner)[key] ?? { value: null, version: 0 }
  }

  keys(owner: string): string[] {
    return Object.keys(this.ns(owner)).sort()
  }

  /** Writes unless `ifVersion` is given and doesn't match the current version. */
  set(owner: string, key: string, value: unknown, ifVersion?: number | null): { ok: boolean; version: number } {
    const entries = this.ns(owner)
    const current = entries[key]?.version ?? 0
    if (ifVersion !== undefined && ifVersion !== null && ifVersion !== current) return { ok: false, version: current }
    entries[key] = { value: value ?? null, version: current + 1 }
    this.save(owner)
    return { ok: true, version: current + 1 }
  }

  delete(owner: string, key: string): boolean {
    const entries = this.ns(owner)
    if (!(key in entries)) return false
    delete entries[key]
    this.save(owner)
    return true
  }

  namespaces(): string[] {
    try {
      return readdirSync(this.dir()).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
    } catch {
      return []
    }
  }
}

/**
 * Routes everything plugins do with each other: service calls, events and
 * shared state. Plugins only reach plugins they declare as dependencies.
 */
export class Broker {
  readonly shared: SharedStore
  private watchers = new Map<string, Set<string>>()

  constructor(
    private peers: () => BrokerPeer[],
    shared?: SharedStore
  ) {
    this.shared = shared ?? new SharedStore()
  }

  private byModule(module: string): BrokerPeer | undefined {
    return this.peers().find((p) => p.module === module)
  }

  private requireDependency(caller: BrokerPeer, module: string, what: string): BrokerPeer {
    if (module !== caller.module && !(module in caller.dependencies)) {
      throw new BrokerError(`${what} needs "${module}" listed under "dependencies" in ${caller.name}'s plugin.json`)
    }
    const target = this.byModule(module)
    if (!target) throw new BrokerError(`The "${module}" plugin isn't installed`)
    return target
  }

  // ---------------------------------------------------------------- services

  async callService(caller: BrokerPeer, params: Record<string, unknown>): Promise<unknown> {
    const module = String(params.plugin ?? '')
    const method = String(params.method ?? '')
    const target = this.requireDependency(caller, module, `Calling ${module}.${method}`)
    if (!target.process?.running) throw new BrokerError(`${target.name} isn't running`)
    if (!target.services.includes(method)) {
      throw new BrokerError(`${target.name} doesn't expose "${method}". Exposed: ${target.services.join(', ') || 'nothing'}`)
    }
    const timeout = typeof params.timeout === 'number' && params.timeout > 0 ? params.timeout * 1000 : SERVICE_TIMEOUT_MS
    return target.process.request(
      'services.call',
      { method, args: params.args ?? [], kwargs: params.kwargs ?? {}, caller: caller.module },
      timeout
    )
  }

  listServices(caller: BrokerPeer): { module: string; name: string; running: boolean; services: string[] }[] {
    return Object.keys(caller.dependencies).map((module) => {
      const p = this.byModule(module)
      return { module, name: p?.name ?? module, running: !!p?.process?.running, services: p?.services ?? [] }
    })
  }

  // ------------------------------------------------------------------ events

  /** Delivers `topic` to subscribers allowed to see it. `source` is a plugin or "app". */
  publish(source: BrokerPeer | 'app', topic: string, data: unknown): number {
    const sourceModule = source === 'app' ? 'app' : source.module
    const fullTopic = source === 'app' ? `app.${topic}` : `${source.module}.${topic}`
    let delivered = 0
    for (const peer of this.peers()) {
      if (peer === source || !peer.process?.running) continue
      if (sourceModule !== 'app' && !(sourceModule in peer.dependencies)) continue
      if (!peer.subscriptions.some((pattern) => topicMatches(pattern, fullTopic))) continue
      delivered++
      void peer.process.request('events.deliver', { topic: fullTopic, data, source: sourceModule }).catch(() => {})
    }
    return delivered
  }

  // ------------------------------------------------------------ shared state

  private canRead(caller: BrokerPeer, owner: string): boolean {
    if (caller.module === owner) return true
    if (!(owner in caller.dependencies)) return false
    return !!this.byModule(owner)
  }

  private canWrite(caller: BrokerPeer, owner: string): boolean {
    if (caller.module === owner) return true
    const ownerPeer = this.byModule(owner)
    if (!ownerPeer || !(owner in caller.dependencies)) return false
    return ownerPeer.sharedWriters.includes('*') || ownerPeer.sharedWriters.includes(caller.module)
  }

  sharedRequest(caller: BrokerPeer, method: string, params: Record<string, unknown>): unknown {
    const owner = String(params.namespace ?? caller.module)
    const key = String(params.key ?? '')
    const write = method === 'shared.set' || method === 'shared.delete'
    if (write ? !this.canWrite(caller, owner) : !this.canRead(caller, owner)) {
      throw new BrokerError(
        write
          ? `${caller.name} can't write to "${owner}"'s shared state. The owner must list "${caller.module}" under "shared": {"writers": [...]}, and ${caller.name} must depend on it.`
          : `${caller.name} can't read "${owner}"'s shared state. Add "${owner}" under "dependencies".`
      )
    }
    switch (method) {
      case 'shared.get':
        return this.shared.get(owner, key)
      case 'shared.keys':
        return this.shared.keys(owner)
      case 'shared.watch': {
        const set = this.watchers.get(owner) ?? new Set()
        set.add(caller.id)
        this.watchers.set(owner, set)
        return null
      }
      case 'shared.set': {
        const result = this.shared.set(owner, key, params.value, params.ifVersion as number | null | undefined)
        if (result.ok) this.notifyShared(owner, key, params.value ?? null, result.version)
        return result
      }
      case 'shared.delete':
        if (this.shared.delete(owner, key)) this.notifyShared(owner, key, null, 0)
        return null
      default:
        throw new BrokerError(`unknown method ${method}`)
    }
  }

  private notifyShared(owner: string, key: string, value: unknown, version: number): void {
    const ids = this.watchers.get(owner)
    if (!ids) return
    for (const peer of this.peers()) {
      if (!ids.has(peer.id) || !peer.process?.running || !this.canRead(peer, owner)) continue
      void peer.process.request('events.deliver', { topic: `$shared.${owner}`, data: { key, value, version }, source: owner }).catch(() => {})
    }
  }

  /** Forget a plugin's watches (it stopped). */
  forget(id: string): void {
    for (const set of this.watchers.values()) set.delete(id)
  }
}

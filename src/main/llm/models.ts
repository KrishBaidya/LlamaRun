import { app } from 'electron'
import { z } from 'zod'
import { BASE_SERVER_URL } from '@shared/constants'
import type { ModelCapability, ModelGroup, ModelInfo, ModelStatus, ModelTier } from '@shared/types'
import { readJson, writeJson } from '../jsonFile'
import { userDataPath } from '../paths'
import snapshotJson from './models.snapshot.json'

/**
 * Cloud model catalog, served by the LlamaRun backend at GET /api/v1/models so new
 * models can ship without an app update. Resolution order:
 *   1. in-memory / disk cache (userData/cache/models.json) while fresh (10 min)
 *   2. the server (8 s timeout)
 *   3. the stale cache, if the server is unreachable or returns garbage
 *   4. the bundled snapshot (models.snapshot.json, refreshed by `npm run sync-models`)
 */

/** Cloud providers this build knows how to route and render. */
const CLOUD_PROVIDERS = ['gemini', 'openai'] as const
type CloudProvider = (typeof CLOUD_PROVIDERS)[number]
const CAPABILITIES: readonly ModelCapability[] = ['tools', 'vision', 'thinking', 'fast', 'search']
const TIERS: readonly ModelTier[] = ['free', 'pro']
const STATUSES: readonly ModelStatus[] = ['stable', 'preview', 'dev']

export const FETCH_TIMEOUT_MS = 8_000
/** A cached catalog younger than this is used without asking the server. */
export const FRESH_MS = 10 * 60_000
/** After a failed fetch, wait this long before trying again so pickers don't stall. */
const RETRY_MS = 60_000

export interface CloudCatalog {
  version: string
  /** Every known cloud model, including `dev` ones (filtered on read). */
  groups: ModelGroup[]
}

export type CatalogSource = 'network' | 'cache' | 'snapshot'

export interface LoadedCatalog {
  version: string
  /** Groups visible in this build (dev models dropped when packaged). */
  groups: ModelGroup[]
  source: CatalogSource
  /** When the catalog was fetched from the server (absent for the snapshot). */
  fetchedAt?: number
}

interface CacheFile {
  at: number
  server: string
  catalog: CloudCatalog
}

// Lenient on purpose: unknown fields/values from a newer server are dropped, not fatal.
const ModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().nullish(),
  description: z.string().nullish(),
  capabilities: z.array(z.string()).nullish(),
  tier: z.string().nullish(),
  contextWindow: z.number().positive().nullish(),
  status: z.string().nullish()
})

const CatalogSchema = z.object({
  version: z.union([z.string(), z.number()]).transform(String).nullish(),
  groups: z.array(
    z.object({
      provider: z.string(),
      label: z.string().min(1),
      models: z.array(z.unknown())
    })
  )
})

const isCloudProvider = (p: string): p is CloudProvider => (CLOUD_PROVIDERS as readonly string[]).includes(p)
const pick = <T extends string>(allowed: readonly T[], value: string | null | undefined): T | undefined =>
  value != null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined

/**
 * Validates a server (or snapshot) payload. Groups with providers this build doesn't
 * know are skipped with a warning, as are malformed models. Returns null when nothing
 * usable is left.
 */
export function parseCatalog(body: unknown, origin = 'server'): CloudCatalog | null {
  const parsed = CatalogSchema.safeParse(body)
  if (!parsed.success) {
    console.warn(`[models] Ignoring invalid catalog from ${origin}: ${parsed.error.message}`)
    return null
  }
  const groups: ModelGroup[] = []
  const seen = new Set<string>()
  for (const group of parsed.data.groups) {
    if (!isCloudProvider(group.provider)) {
      console.warn(`[models] Ignoring unknown provider "${group.provider}" from ${origin}`)
      continue
    }
    const models: ModelInfo[] = []
    for (const raw of group.models) {
      const m = ModelSchema.safeParse(raw)
      if (!m.success) {
        console.warn(`[models] Ignoring malformed model in "${group.provider}" from ${origin}`)
        continue
      }
      const model = m.data
      if (model.provider != null && model.provider !== group.provider) {
        console.warn(`[models] Ignoring "${model.id}": provider "${model.provider}" doesn't match its group`)
        continue
      }
      if (seen.has(model.id)) continue
      seen.add(model.id)
      models.push({
        id: model.id,
        name: model.name,
        provider: group.provider,
        cloud: true,
        description: model.description ?? undefined,
        capabilities: (model.capabilities ?? []).filter((c): c is ModelCapability =>
          (CAPABILITIES as readonly string[]).includes(c)
        ),
        tier: pick(TIERS, model.tier),
        contextWindow: model.contextWindow ?? undefined,
        status: pick(STATUSES, model.status)
      })
    }
    if (models.length) groups.push({ provider: group.provider, label: group.label, models })
  }
  if (!groups.length) {
    console.warn(`[models] Catalog from ${origin} has no usable models`)
    return null
  }
  return { version: parsed.data.version ?? 'unknown', groups }
}

const SNAPSHOT: CloudCatalog = parseCatalog(snapshotJson, 'snapshot') ?? { version: 'snapshot', groups: [] }

function visibleGroups(catalog: CloudCatalog): ModelGroup[] {
  if (!app.isPackaged) return catalog.groups
  return catalog.groups
    .map((g) => ({ ...g, models: g.models.filter((m) => m.status !== 'dev') }))
    .filter((g) => g.models.length > 0)
}

const cachePath = (): string => userDataPath('cache', 'models.json')

// undefined = not read from disk yet; null = no usable cache.
let current: CacheFile | null | undefined
let lastFailureAt = 0
let inflight: Promise<LoadedCatalog> | null = null

/** The last successfully fetched catalog (memory, else disk), if any. */
function cached(): CacheFile | null {
  if (current === undefined) {
    const stored = readJson<Partial<CacheFile> | null>(cachePath(), null)
    const catalog = stored?.catalog ? parseCatalog(stored.catalog, 'cache') : null
    current =
      catalog && typeof stored?.at === 'number' && stored.server === BASE_SERVER_URL
        ? { at: stored.at, server: BASE_SERVER_URL, catalog }
        : null
  }
  return current
}

function fromCache(entry: CacheFile): LoadedCatalog {
  return { version: entry.catalog.version, groups: visibleGroups(entry.catalog), source: 'cache', fetchedAt: entry.at }
}

function fallback(): LoadedCatalog {
  const entry = cached()
  if (entry) return fromCache(entry)
  return { version: SNAPSHOT.version, groups: visibleGroups(SNAPSHOT), source: 'snapshot' }
}

export function catalogUrl(): string {
  return `${BASE_SERVER_URL}/api/v1/models${app.isPackaged ? '' : '?includeDev=1'}`
}

async function fetchCatalog(): Promise<CloudCatalog> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(catalogUrl(), { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`Model catalog returned HTTP ${res.status}`)
    const catalog = parseCatalog(await res.json())
    if (!catalog) throw new Error('Model catalog response was invalid')
    return catalog
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Returns the cloud catalog, refreshing it from the server when the cached copy is
 * older than 10 minutes (or `force` is set). Never throws: falls back to the stale
 * cache, then the bundled snapshot.
 */
export async function loadCloudCatalog({ force = false }: { force?: boolean } = {}): Promise<LoadedCatalog> {
  const entry = cached()
  const now = Date.now()
  if (!force && entry && now - entry.at < FRESH_MS) return fromCache(entry)
  if (!force && now - lastFailureAt < RETRY_MS) return fallback()
  if (inflight) return inflight

  inflight = (async (): Promise<LoadedCatalog> => {
    try {
      const catalog = await fetchCatalog()
      const fresh: CacheFile = { at: Date.now(), server: BASE_SERVER_URL, catalog }
      current = fresh
      lastFailureAt = 0
      try {
        writeJson(cachePath(), fresh)
      } catch (err) {
        console.warn('[models] Could not write the catalog cache:', err)
      }
      return { version: catalog.version, groups: visibleGroups(catalog), source: 'network', fetchedAt: fresh.at }
    } catch (err) {
      lastFailureAt = Date.now()
      console.warn(`[models] Using ${cached() ? 'cached' : 'bundled'} model catalog:`, err instanceof Error ? err.message : err)
      return fallback()
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Cloud groups visible right now, without touching the network. */
export function cloudModelGroups(): ModelGroup[] {
  return fallback().groups
}

/**
 * Synchronous routing check against the last-loaded catalog plus the bundled snapshot,
 * so generation never waits on the network. Deliberately unfiltered: a `dev` model (or
 * one a user saved before it was hidden) is still a cloud id, so it goes to the backend,
 * which can reject it clearly, instead of being misrouted to Ollama.
 */
export function isCloudModel(id: string): boolean {
  const has = (groups: ModelGroup[]): boolean => groups.some((g) => g.models.some((m) => m.id === id))
  const entry = cached()
  return (entry !== null && has(entry.catalog.groups)) || has(SNAPSHOT.groups)
}

/** Test hook: forget in-memory state so the next call re-reads the disk cache. */
export function resetModelCatalog(): void {
  current = undefined
  lastFailureAt = 0
  inflight = null
}

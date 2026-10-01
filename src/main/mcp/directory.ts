import type { McpDirectoryPage, McpDirectoryQuery, McpDirectoryServer } from '@shared/types'
import { MCP_DIRECTORY_URL } from '@shared/constants'
import { readJson, writeJson } from '../jsonFile'
import { userDataPath } from '../paths'

export const DIRECTORY_PAGE_SIZE = 12
/** Pages younger than this are served without asking the server again. */
const FRESH_MS = 10 * 60_000
/** Entries older than this are dropped from the disk cache. */
const MAX_AGE_MS = 7 * 24 * 60 * 60_000
const MAX_ENTRIES = 200

interface Entry<T> {
  at: number
  value: T
}

/**
 * Directory responses cached in memory and on disk (userData/cache/mcp-directory.json).
 * Fresh entries are returned directly; stale ones are returned with `stale: true`
 * so the page can show them instantly and refresh in the background.
 */
class DirectoryCache {
  private entries: Map<string, Entry<unknown>> | null = null
  private saveTimer: NodeJS.Timeout | null = null

  private get path(): string {
    return userDataPath('cache', 'mcp-directory.json')
  }

  private all(): Map<string, Entry<unknown>> {
    if (this.entries) return this.entries
    const now = Date.now()
    const stored = readJson<Record<string, Entry<unknown>>>(this.path, {})
    this.entries = new Map(Object.entries(stored).filter(([, e]) => e && now - e.at < MAX_AGE_MS))
    return this.entries
  }

  get<T>(key: string): Entry<T> | undefined {
    return this.all().get(key) as Entry<T> | undefined
  }

  set<T>(key: string, value: T): void {
    const entries = this.all()
    entries.delete(key) // re-insert so Map order tracks recency
    entries.set(key, { at: Date.now(), value })
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
    this.scheduleSave()
  }

  clear(): void {
    this.all().clear()
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      writeJson(this.path, Object.fromEntries(this.all()))
    }, 500)
  }
}

const cache = new DirectoryCache()
const inflight = new Map<string, Promise<unknown>>()

/** Dedupes concurrent requests for the same key. */
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined
  if (running) return running
  const promise = load().finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}

async function fetchJson<T>(url: URL): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`MCP directory returned HTTP ${res.status}`)
  return (await res.json()) as T
}

export async function listDirectory(query: McpDirectoryQuery): Promise<McpDirectoryPage> {
  const search = query.search?.trim() ?? ''
  const key = `page:${search.toLowerCase()}:${query.cursor ?? ''}`
  const cached = cache.get<McpDirectoryPage>(key)
  if (cached && !query.fresh) {
    const stale = Date.now() - cached.at > FRESH_MS
    return { ...cached.value, cachedAt: cached.at, stale }
  }

  return once(key, async () => {
    const url = new URL('/api/servers', MCP_DIRECTORY_URL)
    url.searchParams.set('limit', String(DIRECTORY_PAGE_SIZE))
    if (search) url.searchParams.set('search', search)
    if (query.cursor) url.searchParams.set('cursorId', query.cursor)
    try {
      const body = await fetchJson<Partial<McpDirectoryPage>>(url)
      const page: McpDirectoryPage = { servers: body.servers ?? [], nextCursor: body.nextCursor ?? null }
      cache.set(key, page)
      for (const server of page.servers) cache.set(`server:${server.id}`, server)
      return { ...page, cachedAt: Date.now(), stale: false }
    } catch (err) {
      // Offline: an old copy beats an error.
      if (cached) return { ...cached.value, cachedAt: cached.at, stale: true }
      throw err
    }
  })
}

export async function getDirectoryServer(id: string): Promise<McpDirectoryServer> {
  const key = `server:${id}`
  const cached = cache.get<McpDirectoryServer>(key)
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.value
  return once(key, async () => {
    try {
      const body = await fetchJson<McpDirectoryServer | { server: McpDirectoryServer }>(
        new URL(`/api/servers/${encodeURIComponent(id)}`, MCP_DIRECTORY_URL)
      )
      const server = 'server' in body ? body.server : body
      cache.set(key, server)
      return server
    } catch (err) {
      if (cached) return cached.value
      throw err
    }
  })
}

export function clearDirectoryCache(): void {
  cache.clear()
}

export function readmeUrl(id: string): string {
  return new URL(`/server_readme/${encodeURIComponent(id)}`, MCP_DIRECTORY_URL).toString()
}


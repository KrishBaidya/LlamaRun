import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import snapshot from '../src/main/llm/models.snapshot.json'

const dir = mkdtempSync(join(tmpdir(), 'llamarun-models-'))
// Mutable so tests can flip `isPackaged`; the factory runs lazily on the first import below.
const electronApp = { getPath: () => dir, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' }
vi.mock('electron', () => ({ app: electronApp }))

const { BASE_SERVER_URL } = await import('@shared/constants')
const { loadCloudCatalog, cloudModelGroups, isCloudModel, parseCatalog, resetModelCatalog, FRESH_MS } = await import(
  '../src/main/llm/models'
)

const cacheFile = join(dir, 'cache', 'models.json')
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id.toUpperCase(),
  provider: 'gemini',
  description: `${id} model`,
  capabilities: ['tools', 'search'],
  tier: 'free',
  contextWindow: 1_000_000,
  status: 'stable',
  ...extra
})

const serverCatalog = {
  version: '2026-10-01',
  groups: [
    { provider: 'gemini', label: 'Google Gemini', models: [model('gemini-9-ultra', { tier: 'pro' }), model('gemini-lab', { status: 'dev' })] },
    { provider: 'anthropic', label: 'Anthropic', models: [model('claude-x', { provider: 'anthropic' })] }
  ]
}

function respond(body: unknown, ok = true): void {
  fetchMock.mockResolvedValueOnce({ ok, status: ok ? 200 : 500, json: async () => body })
}

const ids = (groups: { models: { id: string }[] }[]): string[] => groups.flatMap((g) => g.models.map((m) => m.id))

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  fetchMock.mockReset()
  rmSync(join(dir, 'cache'), { recursive: true, force: true })
  electronApp.isPackaged = false
  resetModelCatalog()
  vi.useRealTimers()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('cloud model catalog', () => {
  it('fetches the catalog from the server and caches it to disk', async () => {
    respond(serverCatalog)
    const loaded = await loadCloudCatalog()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE_SERVER_URL}/api/v1/models?includeDev=1`)
    expect(loaded.source).toBe('network')
    expect(loaded.version).toBe('2026-10-01')
    expect(loaded.groups).toHaveLength(1)
    expect(loaded.groups[0]).toMatchObject({ provider: 'gemini', label: 'Google Gemini' })
    expect(loaded.groups[0].models[0]).toEqual({
      id: 'gemini-9-ultra',
      name: 'GEMINI-9-ULTRA',
      provider: 'gemini',
      cloud: true,
      description: 'gemini-9-ultra model',
      capabilities: ['tools', 'search'],
      tier: 'pro',
      contextWindow: 1_000_000,
      status: 'stable'
    })
    expect(existsSync(cacheFile)).toBe(true)
    expect(JSON.parse(readFileSync(cacheFile, 'utf8')).catalog.version).toBe('2026-10-01')

    // Fresh cache: served without hitting the network again.
    const again = await loadCloudCatalog()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(again.source).toBe('cache')
    expect(ids(again.groups)).toEqual(ids(loaded.groups))
  })

  it('refetches once the cache is older than 10 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    respond(serverCatalog)
    await loadCloudCatalog()
    vi.setSystemTime(Date.now() + FRESH_MS + 1_000)
    respond({ ...serverCatalog, version: 'v2' })
    expect((await loadCloudCatalog()).version).toBe('v2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to the stale cache when the fetch fails', async () => {
    respond(serverCatalog)
    await loadCloudCatalog()
    resetModelCatalog() // simulate a restart: the cache now comes from disk

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const offline = await loadCloudCatalog({ force: true })
    expect(offline.source).toBe('cache')
    expect(ids(offline.groups)).toContain('gemini-9-ultra')
  })

  it('falls back to the cache when the server returns an error or garbage', async () => {
    respond(serverCatalog)
    await loadCloudCatalog()
    respond({}, false)
    expect((await loadCloudCatalog({ force: true })).source).toBe('cache')
    respond({ groups: 'nope' })
    expect((await loadCloudCatalog({ force: true })).source).toBe('cache')
  })

  it('uses the bundled snapshot when there is no cache', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const loaded = await loadCloudCatalog()
    expect(loaded.source).toBe('snapshot')
    expect(loaded.version).toBe(String(snapshot.version))
    expect(ids(loaded.groups)).toEqual(ids(snapshot.groups))
    // Failures back off instead of stalling every picker for the timeout.
    expect((await loadCloudCatalog()).source).toBe('snapshot')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts a request that takes longer than the timeout', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))
    )
    const pending = loadCloudCatalog()
    await vi.advanceTimersByTimeAsync(8_000)
    expect((await pending).source).toBe('snapshot')
  })

  it('drops dev models in packaged builds', async () => {
    electronApp.isPackaged = true
    respond(serverCatalog)
    const loaded = await loadCloudCatalog()
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE_SERVER_URL}/api/v1/models`)
    expect(ids(loaded.groups)).toEqual(['gemini-9-ultra'])

    resetModelCatalog()
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    const fromCache = await loadCloudCatalog({ force: true })
    expect(fromCache.source).toBe('cache')
    expect(ids(fromCache.groups)).toEqual(['gemini-9-ultra']) // still filtered
  })

  it('hides dev models from the snapshot when packaged and shows them in development', () => {
    expect(ids(cloudModelGroups())).toContain('gpt-4o-mini')
    electronApp.isPackaged = true
    expect(ids(cloudModelGroups())).not.toContain('gpt-4o-mini')
    // Still routed to the cloud backend (which can reject it) rather than to Ollama.
    expect(isCloudModel('gpt-4o-mini')).toBe(true)
  })

  it('ignores unknown providers, capabilities and malformed models', () => {
    const parsed = parseCatalog({
      version: 3,
      groups: [
        ...serverCatalog.groups,
        {
          provider: 'openai',
          label: 'OpenAI',
          models: [model('gpt-next', { provider: 'openai', capabilities: ['tools', 'telepathy'], tier: 'ultra' }), { id: 42 }]
        }
      ]
    })
    expect(parsed?.version).toBe('3')
    expect(parsed?.groups.map((g) => g.provider)).toEqual(['gemini', 'openai'])
    const next = parsed!.groups[1].models[0]
    expect(next.capabilities).toEqual(['tools'])
    expect(next.tier).toBeUndefined()
    expect(parsed!.groups[1].models).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown provider "anthropic"'))
    expect(parseCatalog({ groups: [{ provider: 'anthropic', label: 'A', models: [model('x')] }] })).toBeNull()
    // Null optional fields (common serializer output) are treated as missing, not invalid.
    const nulls = parseCatalog({
      version: null,
      groups: [{ provider: 'gemini', label: 'G', models: [model('g', { description: null, contextWindow: null, tier: null })] }]
    })
    expect(nulls?.groups[0].models[0]).toMatchObject({ id: 'g', description: undefined, contextWindow: undefined, tier: undefined })
  })

  it('isCloudModel checks the loaded catalog plus the snapshot without blocking', async () => {
    expect(isCloudModel('gemini-2.5-flash')).toBe(true) // snapshot
    expect(isCloudModel('gemini-9-ultra')).toBe(false)
    expect(isCloudModel('llama3.2:latest')).toBe(false)
    respond(serverCatalog)
    await loadCloudCatalog()
    expect(isCloudModel('gemini-9-ultra')).toBe(true)
    expect(isCloudModel('gemini-2.5-flash')).toBe(true) // still known via the snapshot
    expect(isCloudModel('claude-x')).toBe(false) // unknown provider was dropped
  })

  it('reads a cache written by a previous run for routing', () => {
    mkdirSync(join(dir, 'cache'), { recursive: true })
    writeFileSync(
      cacheFile,
      JSON.stringify({ at: Date.now(), server: BASE_SERVER_URL, catalog: parseCatalog(serverCatalog) })
    )
    expect(isCloudModel('gemini-9-ultra')).toBe(true)
  })

  it('ignores a cache written for a different server', async () => {
    mkdirSync(join(dir, 'cache'), { recursive: true })
    writeFileSync(
      cacheFile,
      JSON.stringify({ at: Date.now(), server: 'https://elsewhere.example', catalog: parseCatalog(serverCatalog) })
    )
    expect(isCloudModel('gemini-9-ultra')).toBe(false)
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    expect((await loadCloudCatalog()).source).toBe('snapshot')
  })

  it('ships a snapshot that matches the contract', () => {
    const parsed = parseCatalog(snapshot)!
    expect(parsed.version).toBe(String(snapshot.version))
    expect(parsed.groups.map((g) => [g.provider, g.label])).toEqual([
      ['gemini', 'Google Gemini'],
      ['openai', 'OpenAI']
    ])
    expect(ids(parsed.groups)).toEqual([
      'gemini-2.0-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash-lite',
      'gemini-2.5-pro',
      'gemini-3.8-flash',
      'gpt-4o-mini',
      'gpt-4.1-mini',
      'gpt-4.1-nano'
    ])
    for (const m of parsed.groups.flatMap((g) => g.models)) {
      expect(m.tier).toBeDefined()
      expect(m.status).toBeDefined()
      expect(m.contextWindow).toBeGreaterThan(0)
    }
  })
})

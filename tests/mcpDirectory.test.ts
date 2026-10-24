import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'llamarun-dir-'))
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' }
}))

const { listDirectory, getDirectoryServer, clearDirectoryCache } = await import('../src/main/mcp/directory')

const server = (id: string) => ({ id, name: id, description: '' })
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function respond(body: unknown, ok = true): void {
  fetchMock.mockResolvedValueOnce({ ok, status: ok ? 200 : 500, json: async () => body })
}

beforeEach(() => {
  fetchMock.mockReset()
  clearDirectoryCache()
  vi.useRealTimers()
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('MCP directory cache', () => {
  it('serves repeat requests from the cache', async () => {
    respond({ servers: [server('a')], nextCursor: 'c1' })
    const first = await listDirectory({ search: 'Git' })
    const second = await listDirectory({ search: 'git ' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.servers).toEqual(first.servers)
    expect(second.stale).toBe(false)
    // Servers from a page are cached for the details view too.
    expect(await getDirectoryServer('a')).toEqual(server('a'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('marks old entries stale and refetches when asked for fresh data', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    respond({ servers: [server('a')], nextCursor: null })
    await listDirectory({})
    vi.setSystemTime(Date.now() + 11 * 60_000)
    expect((await listDirectory({})).stale).toBe(true)
    respond({ servers: [server('b')], nextCursor: null })
    const fresh = await listDirectory({ fresh: true })
    expect(fresh.servers).toEqual([server('b')])
    expect(fresh.stale).toBe(false)
  })

  it('answers a stale server from the cache and refreshes it in the background', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    respond({ servers: [server('a')], nextCursor: null })
    await listDirectory({})
    vi.setSystemTime(Date.now() + 11 * 60_000)
    respond({ ...server('a'), name: 'A2' })
    expect(await getDirectoryServer('a')).toEqual(server('a'))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await new Promise((r) => setImmediate(r))
    expect((await getDirectoryServer('a')).name).toBe('A2')
  })

  it('falls back to the cached copy when offline', async () => {
    respond({ servers: [server('a')], nextCursor: null })
    await listDirectory({})
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const offline = await listDirectory({ fresh: true })
    expect(offline.servers).toEqual([server('a')])
    expect(offline.stale).toBe(true)
  })

  it('dedupes concurrent requests and reports HTTP errors without a cache', async () => {
    respond({ servers: [], nextCursor: null })
    await Promise.all([listDirectory({ search: 'x' }), listDirectory({ search: 'x' })])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    respond({}, false)
    await expect(listDirectory({ search: 'y' })).rejects.toThrow('HTTP 500')
  })
})

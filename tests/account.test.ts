import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-account-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn(async () => {}) }
}))

const { auth, parseAccount } = await import('../src/main/auth')
const { generateCloud, GENERATE_URL, LEGACY_GENERATE_URL, cloudUsage } = await import('../src/main/llm/cloud')
const { BASE_SERVER_URL } = await import('../src/shared/constants')

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ME = {
  profile: { displayName: 'Ada', email: 'ada@example.com', photoURL: 'https://x/p.png' },
  plan: { tier: 'free', status: 'none', currentPeriodEnd: null },
  usage: { used: 180, limit: 200, periodEnd: '2026-11-01T00:00:00.000Z' }
}

afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('parseAccount', () => {
  it('maps a /api/v1/me body', () => {
    expect(parseAccount(ME)).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
      photoURL: 'https://x/p.png',
      plan: { tier: 'free', status: 'none', currentPeriodEnd: null },
      usage: { used: 180, limit: 200, periodEnd: '2026-11-01T00:00:00.000Z' }
    })
  })

  it('maps a legacy profile body and tolerates junk', () => {
    expect(parseAccount({ profile: { email: 'a@b.c' } })).toEqual({
      name: 'User',
      email: 'a@b.c',
      photoURL: '',
      plan: undefined,
      usage: undefined
    })
    const odd = parseAccount({ plan: { tier: 'pro', status: 'weird', currentPeriodEnd: 5 }, usage: { used: '1' } })
    expect(odd.plan).toEqual({ tier: 'pro', status: 'none', currentPeriodEnd: null })
    expect(odd.usage).toBeUndefined()
    expect(parseAccount(null).name).toBe('User')
  })
})

describe('auth.refreshProfile', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, ME)))
    await auth.setToken('tok')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    auth.signOut()
  })

  it('reads plan and usage from /api/v1/me with the bearer token', async () => {
    const fetchMock = vi.fn(async () => json(200, ME))
    vi.stubGlobal('fetch', fetchMock)
    const profile = await auth.refreshProfile()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_SERVER_URL}/api/v1/me`, { headers: { Authorization: 'Bearer tok' } })
    expect(profile).toMatchObject({ signedIn: true, name: 'Ada', plan: { tier: 'free' }, usage: { used: 180, limit: 200 } })
  })

  it('falls back to the legacy profile endpoint on 404', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/api/v1/me') ? json(404, {}) : json(200, { profile: { displayName: 'Old', email: 'o@x' } })
    )
    vi.stubGlobal('fetch', fetchMock)
    const profile = await auth.refreshProfile()
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${BASE_SERVER_URL}/api/v1/me`,
      `${BASE_SERVER_URL}/api/auth/get-profile`
    ])
    expect(profile).toMatchObject({ signedIn: true, name: 'Old', email: 'o@x' })
    expect(profile.plan).toBeUndefined()
    expect(profile.usage).toBeUndefined()
  })

  it('signs out on 401', async () => {
    const changed = vi.fn()
    auth.on('changed', changed)
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'expired' })))
    const profile = await auth.refreshProfile()
    auth.off('changed', changed)
    expect(profile.signedIn).toBe(false)
    expect(profile.plan).toBeUndefined()
    expect(auth.token).toBe('')
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ signedIn: false }))
  })

  it('reuses a recently read profile unless forced', async () => {
    const fetchMock = vi.fn(async (_url: string) => json(200, ME))
    vi.stubGlobal('fetch', fetchMock)
    const meCalls = (): number => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/api/v1/me')).length
    expect(await auth.refreshProfile({ maxAgeMs: 60_000 })).toMatchObject({ signedIn: true, usage: { used: 180 } })
    expect(meCalls()).toBe(0)
    await auth.refreshProfile()
    expect(meCalls()).toBe(1)
  })

  it('keeps the profile photo on disk', async () => {
    auth.signOut()
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const fetchMock = vi.fn(async (url: string) =>
      url === 'https://x/p.png' ? new Response(png, { headers: { 'Content-Type': 'image/png' } }) : json(200, ME)
    )
    vi.stubGlobal('fetch', fetchMock)
    await auth.setToken('tok')
    expect(auth.profile().photoURL).toBe('data:image/png;base64,iVBORw==')
    await auth.refreshProfile()
    expect(fetchMock.mock.calls.filter((c) => c[0] === 'https://x/p.png')).toHaveLength(1)
  })

  it('keeps the cached profile when offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    const profile = await auth.refreshProfile()
    expect(profile).toMatchObject({ signedIn: true, name: 'Ada', usage: { used: 180 } })
  })

  it('opens the pricing and account pages', async () => {
    const { shell } = await import('electron')
    auth.openUpgrade()
    auth.openAccount()
    expect(shell.openExternal).toHaveBeenCalledWith(`${BASE_SERVER_URL}/pricing?from=app`)
    expect(shell.openExternal).toHaveBeenCalledWith(`${BASE_SERVER_URL}/profile`)
  })
})

describe('generateCloud plan errors', () => {
  afterEach(() => vi.unstubAllGlobals())

  const run = (): Promise<string> => generateCloud('hi', { model: 'gemini-2.5-pro', token: 't' } as never)

  it('maps 402 PLAN_REQUIRED with the server message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(402, { error: 'Gemini 2.5 Pro requires LlamaRun Pro', code: 'PLAN_REQUIRED' })))
    const usage = vi.fn()
    cloudUsage.on('changed', usage)
    await expect(run()).rejects.toMatchObject({ code: 'PLAN_REQUIRED', message: 'Gemini 2.5 Pro requires LlamaRun Pro' })
    cloudUsage.off('changed', usage)
    expect(usage).toHaveBeenCalled()
  })

  it('maps 429 QUOTA_EXCEEDED with the server message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(429, { error: 'Monthly limit reached', code: 'QUOTA_EXCEEDED' })))
    await expect(run()).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', message: 'Monthly limit reached' })
  })

  it('treats any 429 as the quota being used up', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Too Many Requests', { status: 429 })))
    await expect(run()).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
  })

  it('does not fall back when the new route sends its own JSON 404', async () => {
    const fetchMock = vi.fn(async () => json(404, { error: 'Unknown model' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(run()).rejects.toMatchObject({ code: 'UNKNOWN', message: 'LlamaRun server returned HTTP 404: Unknown model' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps other errors generic', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, { error: 'bad model' })))
    await expect(run()).rejects.toMatchObject({ code: 'UNKNOWN', message: 'LlamaRun server returned HTTP 400: bad model' })
    vi.stubGlobal('fetch', vi.fn(async () => json(401, {})))
    await expect(run()).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' })
  })

  it('falls back to the legacy generate route on 404, then reports usage', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === GENERATE_URL
        ? json(404, {})
        : new Response(JSON.stringify({ text: { type: 'text-delta', text: 'ok' } }) + JSON.stringify({ done: 'True' }))
    )
    vi.stubGlobal('fetch', fetchMock)
    const usage = vi.fn()
    cloudUsage.on('changed', usage)
    expect(await run()).toBe('ok')
    cloudUsage.off('changed', usage)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([GENERATE_URL, LEGACY_GENERATE_URL])
    expect(usage).toHaveBeenCalledTimes(1)
  })
})

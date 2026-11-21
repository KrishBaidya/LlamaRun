import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatSearch, webSearch } from '../src/main/assistant/webSearch'

afterEach(() => vi.unstubAllGlobals())

describe('web_search', () => {
  it('formats the answer with numbered sources', () => {
    const text = formatSearch('electron 44', { answer: 'Electron 44 ships Chromium 150.', sources: [{ title: 'Releases', url: 'https://e.example/r' }, { url: 'https://b.example' }] })
    expect(text).toContain('Electron 44 ships Chromium 150.')
    expect(text).toContain('[1] Releases - https://e.example/r')
    expect(text).toContain('[2] https://b.example - https://b.example')
  })

  it('sends the query with the token and reads the reply', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ answer: 'Yes.', sources: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    expect(await webSearch('is it raining', 'tok')).toContain('Yes.')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/search$/)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'is it raining' })
  })

  it('explains plan limits and missing sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Daily limit reached' }), { status: 429 })))
    await expect(webSearch('x', 'tok')).rejects.toThrow('Daily limit reached')
    await expect(webSearch('x', '')).rejects.toThrow('sign in')
  })
})

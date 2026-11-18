import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImage } from '../src/main/assistant/imageGen'

afterEach(() => vi.unstubAllGlobals())

describe('image_generate', () => {
  it('sends the prompt and images with the token, and returns the image bytes', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ images: [{ data: Buffer.from('png!').toString('base64'), mediaType: 'image/png' }], text: 'Here you go' })))
    vi.stubGlobal('fetch', fetch)
    const made = await generateImage('a llama in a field', [{ data: 'AAAA', mediaType: 'image/png' }], 'tok')
    expect(made.bytes.toString()).toBe('png!')
    expect(made.text).toBe('Here you go')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/images$/)
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'a llama in a field', images: [{ data: 'AAAA', mediaType: 'image/png' }] })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('explains the plan wall, a refusal and missing sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'PLAN_REQUIRED', error: 'Pro only' }), { status: 403 })))
    await expect(generateImage('x', [], 'tok')).rejects.toThrow('Pro plan')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'NO_IMAGE', error: 'declined' }), { status: 422 })))
    await expect(generateImage('x', [], 'tok')).rejects.toThrow('declined')
    await expect(generateImage('x', [], '')).rejects.toThrow('sign in')
  })
})

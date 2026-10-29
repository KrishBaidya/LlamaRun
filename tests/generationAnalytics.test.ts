import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-genanalytics-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  globalShortcut: {},
  Notification: class {},
  safeStorage: {},
  shell: {}
}))

// A local model that streams "OK" and reports Ollama-style token counts.
vi.mock('../src/main/llm', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/llm')>()
  return {
    ...real,
    modelCatalog: async () => ({ groups: [] }),
    generate: vi.fn(async (_input: unknown, opts: import('../src/main/llm/types').GenerateOptions) => {
      opts.onToken?.('OK')
      opts.onUsage?.({ inputTokens: 12, outputTokens: 3 })
      return 'OK'
    })
  }
})

const { analytics } = await import('../src/main/analytics')
const { chatService } = await import('../src/main/chats/service')
const { pluginHost } = await import('../src/main/plugins/host')

afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('generation analytics', () => {
  it('records each local reply with its tokens and no text', async () => {
    vi.spyOn(pluginHost, 'beforeTextGeneration').mockImplementation(async (text, model) => ({ cancel: false, input_text: text, model }) as Awaited<ReturnType<typeof pluginHost.beforeTextGeneration>>)
    vi.spyOn(pluginHost, 'afterTextGeneration').mockImplementation(async (_input, response) => ({ response_text: response }) as Awaited<ReturnType<typeof pluginHost.afterTextGeneration>>)
    const track = vi.spyOn(analytics, 'track')

    const { done } = chatService.ask(null, 'a private question', { model: 'gemma3:4b' })
    await done

    const finished = track.mock.calls.find(([event]) => event === 'generation_finished')?.[1]
    expect(finished).toMatchObject({ status: 'done', provider: 'ollama', model: 'gemma3:4b', tool_calls: 0, via: 'typed' })
    const generation = track.mock.calls.find(([event]) => event === '$ai_generation')?.[1]
    expect(generation).toMatchObject({
      $ai_provider: 'ollama',
      $ai_model: 'gemma3:4b',
      $ai_input_tokens: 12,
      $ai_output_tokens: 3,
      $ai_total_cost_usd: 0,
      $ai_is_error: false
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain('private question')
    expect(JSON.stringify(track.mock.calls)).not.toContain('"OK"')
  })
})

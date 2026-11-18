import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-usage-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.' } }))
const { describeDays, describeUsage, usageStore } = await import('../src/main/usage')
const { usageOf } = await import('../src/main/llm/cloud')

describe('usage counting', () => {
  it("reads the server's usage parts", () => {
    expect(usageOf({ done: false, text: { type: 'usage', inputTokens: 900, outputTokens: 40, cachedInputTokens: 800, reasoningTokens: 12 } } as never)).toEqual({
      inputTokens: 900,
      outputTokens: 40,
      cachedInputTokens: 800,
      reasoningTokens: 12
    })
    expect(usageOf({ done: false, text: { type: 'text-delta', text: 'hi' } } as never)).toBeNull()
  })

  it('adds up per chat and per day and model, and forgets deleted chats', () => {
    const day = new Date(2026, 10, 18, 12).getTime()
    usageStore.record('c1', 'gemini-a', { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 600 }, day)
    usageStore.record('c1', 'gemini-a', { inputTokens: 1200, outputTokens: 70 }, day)
    usageStore.record('c2', 'gemma4', { inputTokens: 300, outputTokens: 30 }, day)
    usageStore.record('c2', 'gemma4', { inputTokens: 0, outputTokens: 0 }, day)
    expect(usageStore.forChat('c1')).toEqual({ inputTokens: 2200, outputTokens: 120, cachedInputTokens: 600, reasoningTokens: 0, requests: 2 })
    const days = usageStore.days(30, day)
    expect(days).toHaveLength(1)
    expect(days[0].models['gemma4'].requests).toBe(1)
    expect(describeUsage(usageStore.forChat('c1'))).toBe('This chat: 2.2k tokens in (600 read from the cache), 120 out, over 2 requests.')
    expect(describeDays(days)).toContain('- gemini-a: 2.2k in, 120 out, 2 requests')
    usageStore.forgetChat('c1')
    expect(usageStore.forChat('c1')).toBeUndefined()
    usageStore.flush()
    expect(JSON.parse(readFileSync(join(userData, 'usage.json'), 'utf8')).days['2026-11-18'].gemma4.inputTokens).toBe(300)
  })
})

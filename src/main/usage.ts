import { EventEmitter } from 'node:events'
import type { TokenUsage, UsageDay } from '@shared/types'
import { readJson, writeJson } from './jsonFile'
import { userDataPath } from './paths'

/**
 * Tokens each chat and each model used, like Hermes' /usage and /insights and
 * Claude Code's /cost: totals per chat (shown in the context ring and /usage)
 * and per day and model (for summaries over time). Counts only, never content.
 */

/** Days of per-model history kept. */
const KEEP_DAYS = 90

interface UsageFile {
  chats: Record<string, TokenUsage>
  /** YYYY-MM-DD -> model -> totals. */
  days: Record<string, Record<string, TokenUsage>>
}

export const emptyUsage = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, requests: 0 })

export function addUsage(into: TokenUsage, u: Partial<TokenUsage>): TokenUsage {
  into.inputTokens += u.inputTokens ?? 0
  into.outputTokens += u.outputTokens ?? 0
  into.cachedInputTokens += u.cachedInputTokens ?? 0
  into.reasoningTokens += u.reasoningTokens ?? 0
  into.requests += u.requests ?? 1
  return into
}

const dayOf = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

class UsageStore extends EventEmitter<{ changed: [] }> {
  private data: UsageFile | null = null
  private timer: NodeJS.Timeout | null = null

  private get path(): string {
    return userDataPath('usage.json')
  }

  private load(): UsageFile {
    this.data ??= { chats: {}, days: {}, ...readJson<Partial<UsageFile>>(this.path, {}) }
    return this.data
  }

  /** Written a moment later, so a tool-heavy reply's many requests are one write. */
  private save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 2000)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.data) writeJson(this.path, this.data)
  }

  /** One request's tokens for a chat (or none: a plugin's or the review's) and model. */
  record(chatId: string | undefined, model: string, u: Partial<TokenUsage>, at = Date.now()): void {
    if (!model || (!u.inputTokens && !u.outputTokens)) return
    const data = this.load()
    if (chatId) addUsage((data.chats[chatId] ??= emptyUsage()), u)
    const day = (data.days[dayOf(at)] ??= {})
    addUsage((day[model] ??= emptyUsage()), u)
    const days = Object.keys(data.days).sort()
    for (const old of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete data.days[old]
    this.save()
    this.emit('changed')
  }

  forChat(chatId: string): TokenUsage | undefined {
    return this.load().chats[chatId]
  }

  forgetChat(chatId: string): void {
    const data = this.load()
    if (!data.chats[chatId]) return
    delete data.chats[chatId]
    this.save()
  }

  /** Per day and model since a number of days ago, oldest first. */
  days(sinceDays = 30, now = Date.now()): UsageDay[] {
    const from = dayOf(now - sinceDays * 86_400_000)
    return Object.entries(this.load().days)
      .filter(([day]) => day > from)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, models]) => ({ day, models }))
  }
}

export const usageStore = new UsageStore()

export const formatCount = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** One chat's totals as /usage shows them. */
export function describeUsage(u: TokenUsage | undefined, title = 'This chat'): string {
  if (!u || !u.requests) return `${title} hasn't used any tokens that were counted yet.`
  const cached = u.cachedInputTokens ? ` (${formatCount(u.cachedInputTokens)} read from the cache)` : ''
  const reasoning = u.reasoningTokens ? `, ${formatCount(u.reasoningTokens)} of them thinking` : ''
  return `${title}: ${formatCount(u.inputTokens)} tokens in${cached}, ${formatCount(u.outputTokens)} out${reasoning}, over ${u.requests} request${u.requests === 1 ? '' : 's'}.`
}

/** The last days' totals per model, for /usage. */
export function describeDays(days: UsageDay[]): string {
  const byModel = new Map<string, TokenUsage>()
  for (const { models } of days) for (const [model, u] of Object.entries(models)) addUsage(byModel.get(model) ?? byModel.set(model, emptyUsage()).get(model)!, u)
  if (!byModel.size) return ''
  const rows = [...byModel.entries()].sort((a, b) => b[1].inputTokens + b[1].outputTokens - (a[1].inputTokens + a[1].outputTokens))
  return `Last 30 days by model:\n${rows.map(([m, u]) => `- ${m}: ${formatCount(u.inputTokens)} in, ${formatCount(u.outputTokens)} out, ${u.requests} requests`).join('\n')}`
}

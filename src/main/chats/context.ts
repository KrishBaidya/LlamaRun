import type { ContextUsage, McpToolInfo, ModelContextInfo, ModelInfo, Settings } from '@shared/types'
import type { HistoryMessage } from '../llm'

/** A model that reports no context window gets this, and the UI says so. */
export const FALLBACK_CONTEXT_TOKENS = 8192
/** Ollama: the default num_ctx ceiling, so a 128K model doesn't fill RAM unless the user raises it. */
export const OLLAMA_DEFAULT_MAX_CONTEXT = 32_768
/** Rough cost of one image in tokens (vision models charge about this for a ~1.5 MP image). */
const IMAGE_TOKENS = 1000

/** About four characters per token across English text and code. */
export const estimateTextTokens = (text: string): number => Math.ceil(text.length / 4)

/** Tokens the next request would use: history, instructions and the tool list. */
export function estimateTokens(history: HistoryMessage[], system?: string, tools: McpToolInfo[] = []): number {
  let total = estimateTextTokens(system ?? '')
  for (const m of history) total += estimateTextTokens(m.content) + 4 + (m.images?.length ?? 0) * IMAGE_TOKENS
  if (tools.length) total += estimateTextTokens(JSON.stringify(tools.map((t) => [t.name, t.description, t.inputSchema])))
  return total
}

/**
 * The context window one model gets: the user's override for that model,
 * else what that model itself reports (cloud: its catalog entry; Ollama: its
 * context_length, capped at OLLAMA_DEFAULT_MAX_CONTEXT), else a small fallback.
 * Every model is looked up on its own; nothing is assumed per provider.
 */
export function contextWindowFor(
  modelId: string,
  model: ModelInfo | undefined,
  prefs: Pick<Settings, 'modelContext' | 'autoCompactPercent'>
): ModelContextInfo {
  const override = prefs.modelContext?.[modelId]
  const compactAtPercent = clampPercent(override?.compactAtPercent ?? prefs.autoCompactPercent ?? 80)
  const reported = model?.contextWindow && model.contextWindow > 0 ? model.contextWindow : undefined
  if (override?.contextTokens && override.contextTokens > 0) {
    return { model: modelId, tokens: Math.round(override.contextTokens), source: 'override', reported, compactAtPercent }
  }
  if (reported) {
    const tokens = model?.provider === 'ollama' ? Math.min(reported, OLLAMA_DEFAULT_MAX_CONTEXT) : reported
    return { model: modelId, tokens, source: 'model', reported, compactAtPercent }
  }
  return { model: modelId, tokens: FALLBACK_CONTEXT_TOKENS, source: 'fallback', compactAtPercent }
}

export function clampPercent(value: number): number {
  return Math.min(95, Math.max(50, Math.round(value)))
}

export function usageOf(info: ModelContextInfo, used: number): ContextUsage {
  return { ...info, used, percent: Math.min(100, Math.round((used / info.tokens) * 100)) }
}

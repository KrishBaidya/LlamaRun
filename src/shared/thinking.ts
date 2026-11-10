import type { ModelInfo, ThinkingChoice, ThinkingLevel } from './types'

/** Every cloud level, least to most. */
export const THINKING_LEVELS: readonly ThinkingLevel[] = ['minimal', 'low', 'medium', 'high']
/** Every valid choice: the levels, and Off/On for local models. */
export const THINKING_CHOICES: readonly ThinkingChoice[] = [...THINKING_LEVELS, 'off', 'on']

const LABELS: Record<ThinkingChoice, string> = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', off: 'Off', on: 'On' }

export const thinkingLabel = (choice: ThinkingChoice): string => LABELS[choice]

/**
 * The thinking choices a model offers: the levels on its model card (cloud),
 * Off and On for local models that can think (Ollama's `think`), none otherwise.
 */
export function thinkingChoices(model: ModelInfo | undefined): ThinkingChoice[] {
  if (!model) return []
  if (model.cloud) return [...(model.thinking?.levels ?? [])]
  return model.capabilities?.includes('thinking') ? ['off', 'on'] : []
}

/**
 * A choice made for one model, fitted to another (a chat can switch models):
 * the same choice when the model has it; for cloud models the next level up it
 * has, else its highest (as the server does: 3.8 Flash has no "minimal", so
 * "low"); for local models any level means On. Undefined when the model can't
 * take it, so the next setting in line applies.
 */
export function fitThinking(model: ModelInfo | undefined, choice: ThinkingChoice | undefined): ThinkingChoice | undefined {
  const choices = thinkingChoices(model)
  if (!choice || !choices.length) return undefined
  if (choices.includes(choice)) return choice
  if (!model?.cloud) return 'on'
  if (choice === 'off' || choice === 'on') return undefined
  const wanted = THINKING_LEVELS.indexOf(choice)
  return choices.find((c) => THINKING_LEVELS.indexOf(c as ThinkingLevel) >= wanted) ?? choices[choices.length - 1]
}

/**
 * How hard the model thinks for one turn, first that applies: the chat's own
 * choice, the model's default from Model settings, "low" for a cloud model's
 * computer-use steps (small decisions: faster, fewer output tokens), else
 * nothing (the model's own default).
 */
export function resolveThinking(
  model: ModelInfo | undefined,
  { chat, modelDefault, computerOn }: { chat?: ThinkingChoice; modelDefault?: ThinkingChoice; computerOn?: boolean }
): ThinkingChoice | undefined {
  return fitThinking(model, chat) ?? fitThinking(model, modelDefault) ?? (computerOn && model?.cloud ? fitThinking(model, 'low') : undefined)
}

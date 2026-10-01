import { is } from './env'
import type { ModelCapability, ModelGroup, ModelInfo } from '@shared/types'

type CloudModel = [name: string, id: string, description: string, capabilities: ModelCapability[], devOnly?: boolean]

/** Cloud models served through the LlamaRun backend proxy (port of Models.cs). */
const CLOUD_GROUPS: { provider: 'gemini' | 'openai'; label: string; models: CloudModel[] }[] = [
  {
    provider: 'gemini',
    label: 'Google Gemini',
    models: [
      ['Gemini 2.0 Flash', 'gemini-2.0-flash', 'Quick, capable all-rounder', ['tools', 'vision', 'fast']],
      ['Gemini 2.5 Flash', 'gemini-2.5-flash', 'Balances speed with step-by-step reasoning', ['tools', 'vision', 'thinking']],
      ['Gemini 2.0 Flash Lite', 'gemini-2.0-flash-lite', 'Lowest latency for short answers', ['fast']],
      ['Gemini 3.8 Flash', 'gemini-3.8-flash', 'Best in class from Google', ['fast']]
    ]
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    models: [
      ['GPT 4o Mini', 'gpt-4o-mini', 'Small, fast multimodal model', ['tools', 'vision', 'fast'], true],
      ['GPT 4.1 Mini', 'gpt-4.1-mini', 'Strong at instructions and long context', ['tools', 'vision']],
      ['GPT 4.1 Nano', 'gpt-4.1-nano', 'Fastest and lightest OpenAI model', ['tools', 'fast']]
    ]
  }
]

export function cloudModelGroups(): ModelGroup[] {
  return CLOUD_GROUPS.map((g) => ({
    provider: g.provider,
    label: g.label,
    models: g.models
      .filter(([, , , , devOnly]) => !devOnly || is.dev)
      .map(([name, id, description, capabilities]): ModelInfo => ({
        id,
        name,
        provider: g.provider,
        cloud: true,
        description,
        capabilities
      }))
  }))
}

export function isCloudModel(id: string): boolean {
  return cloudModelGroups().some((g) => g.models.some((m) => m.id === id))
}

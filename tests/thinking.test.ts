import { describe, expect, it } from 'vitest'
import { fitThinking, resolveThinking, thinkingChoices, thinkingLabel } from '../src/shared/thinking'
import type { ModelInfo } from '../src/shared/types'

const flash: ModelInfo = { id: 'gemini-3.8-flash', name: 'Flash', provider: 'gemini', cloud: true, capabilities: ['tools', 'thinking'], thinking: { levels: ['low', 'medium', 'high'], default: 'medium' } }
const lite: ModelInfo = { ...flash, id: 'gemini-3.5-flash-lite', thinking: { levels: ['minimal', 'low', 'medium', 'high'], default: 'minimal' } }
const nano: ModelInfo = { id: 'gpt-4.1-nano', name: 'Nano', provider: 'openai', cloud: true, capabilities: ['tools'] }
const gemma: ModelInfo = { id: 'gemma4:e4b', name: 'gemma4', provider: 'ollama', cloud: false, capabilities: ['tools', 'vision', 'thinking'] }
const llama: ModelInfo = { id: 'llama3.2', name: 'llama', provider: 'ollama', cloud: false, capabilities: ['tools'] }

describe('thinking choices', () => {
  it('offers a cloud model its card levels, local thinking models Off and On, and nothing otherwise', () => {
    expect(thinkingChoices(flash)).toEqual(['low', 'medium', 'high'])
    expect(thinkingChoices(gemma)).toEqual(['off', 'on'])
    expect(thinkingChoices(nano)).toEqual([])
    expect(thinkingChoices(llama)).toEqual([])
    expect(thinkingChoices(undefined)).toEqual([])
    expect(thinkingLabel('minimal')).toBe('Minimal')
  })

  it('fits a choice to a model the way the server does', () => {
    expect(fitThinking(flash, 'minimal')).toBe('low')
    expect(fitThinking(lite, 'minimal')).toBe('minimal')
    expect(fitThinking(flash, 'high')).toBe('high')
    expect(fitThinking({ ...flash, thinking: { levels: ['low'] } }, 'high')).toBe('low')
    // Off/On belong to local models; a level on a local model means On.
    expect(fitThinking(flash, 'off')).toBeUndefined()
    expect(fitThinking(gemma, 'high')).toBe('on')
    expect(fitThinking(gemma, 'off')).toBe('off')
    expect(fitThinking(nano, 'high')).toBeUndefined()
  })

  it('picks the chat choice, then the model default, then low for computer use, then nothing', () => {
    expect(resolveThinking(flash, { chat: 'high', modelDefault: 'low', computerOn: true })).toBe('high')
    expect(resolveThinking(flash, { modelDefault: 'high', computerOn: true })).toBe('high')
    expect(resolveThinking(flash, { computerOn: true })).toBe('low')
    expect(resolveThinking(flash, {})).toBeUndefined()
    // A choice the model can't take falls through to the next setting.
    expect(resolveThinking(flash, { chat: 'on', modelDefault: 'medium' })).toBe('medium')
    // Local models don't start thinking just because computer use is on.
    expect(resolveThinking(gemma, { computerOn: true })).toBeUndefined()
    expect(resolveThinking(gemma, { chat: 'on' })).toBe('on')
    expect(resolveThinking(nano, { chat: 'high', computerOn: true })).toBeUndefined()
  })
})

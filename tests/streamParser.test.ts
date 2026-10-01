import { describe, expect, it } from 'vitest'
import { JsonObjectStreamParser } from '../src/main/llm/streamParser'

describe('JsonObjectStreamParser', () => {
  it('parses concatenated objects split at arbitrary points', () => {
    const stream =
      '{"text":{"type":"text-delta", "id":"1", "textDelta":"He said \\"hi {\\""}}' +
      '{"text":{"type":"tool-call","toolCallId":"1","toolName":"t","args":{"a":[1,{"b":2}]}}}{"done":"True"}'
    for (const size of [1, 3, 7, 1000]) {
      const parser = new JsonObjectStreamParser()
      const out: unknown[] = []
      for (let i = 0; i < stream.length; i += size) out.push(...parser.push(stream.slice(i, i + size)))
      expect(out).toEqual([
        { text: { type: 'text-delta', id: expect.any(String), textDelta: 'He said "hi {"' } },
        { text: { type: 'tool-call', toolCallId: expect.any(String), toolName: 't', args: { a: [1, { b: 2 }] } } },
        { done: 'True' }
      ])
    }
  })

  it('ignores whitespace between objects', () => {
    const parser = new JsonObjectStreamParser()
    expect(parser.push(' {"a":1}\n\r\n {"b":2} ')).toEqual([{ a: 1 }, { b: 2 }])
  })
})

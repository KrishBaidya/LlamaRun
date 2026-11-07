import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { kindOf, MEMORY_BUDGET, MemoryStore } from '../src/main/memory/store'

const dir = mkdtempSync(join(tmpdir(), 'llamarun-memory-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('memory budget and kinds (like Hermes)', () => {
  it('tells facts about the user from notes, older memories included', () => {
    expect(kindOf({ text: 'User prefers metric units' })).toBe('user')
    expect(kindOf({ text: 'The user is a student' })).toBe('user')
    expect(kindOf({ text: 'Edge has 226 tabs open; find needs the whole window' })).toBe('note')
    expect(kindOf({ text: 'User likes tea', kind: 'note' })).toBe('note')
  })

  it("stops the model filling a kind past its budget, so it merges instead; the user's own memories always go in", () => {
    const store = new MemoryStore(() => join(dir, 'memory.json'))
    const entry = 'x'.repeat(400)
    for (let i = 0; i < 5; i++) store.add(`Note ${i} ${entry}`, 'model', 'note')
    expect(store.used('note')).toBeLessThanOrEqual(MEMORY_BUDGET.note)
    expect(() => store.add(`Note 6 ${entry}`, 'model', 'note')).toThrow(/notes are full .* memory_update .* memory_forget/)
    // Room for the other kind.
    expect(store.add('User is called Krish', 'model').kind).toBe('user')
    // Growing an entry past the budget is refused too; shrinking is fine.
    store.add(`Small ${'z'.repeat(140)}`, 'model', 'note')
    const first = store.list()[0]
    expect(() => store.update(first.id, 'y'.repeat(499), 'model')).toThrow(/full/)
    store.update(first.id, 'Short note', 'model')
    // The user adding by hand isn't limited.
    expect(store.add(`My own ${entry}`, 'user', 'note').source).toBe('user')
  })
})

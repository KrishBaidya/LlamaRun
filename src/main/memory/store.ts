import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { MemoryItem } from '@shared/types'
import { readJson, writeJson } from '../jsonFile'
import { userDataPath } from '../paths'

/** Longest single memory; facts, not documents. */
export const MAX_MEMORY_CHARS = 500
/** Memories kept; past this the oldest go first. They are all sent with every message. */
export const MAX_MEMORIES = 200

function clean(text: string): string {
  const value = text.replace(/\s+/g, ' ').trim()
  if (!value) throw new Error('A memory needs some text')
  if (value.length > MAX_MEMORY_CHARS) throw new Error(`Keep a memory under ${MAX_MEMORY_CHARS} characters`)
  return value
}

/** What the model knows about the user, in userData/memory.json. */
export class MemoryStore extends EventEmitter<{ changed: [MemoryItem[]] }> {
  private items: MemoryItem[] | null = null

  constructor(private readonly path: () => string = () => userDataPath('memory.json')) {
    super()
  }

  list(): MemoryItem[] {
    this.items ??= readJson<MemoryItem[]>(this.path(), []).filter((m) => m?.id && typeof m.text === 'string')
    return this.items
  }

  get(id: string): MemoryItem | undefined {
    return this.list().find((m) => m.id === id)
  }

  add(text: string, source: string): MemoryItem {
    const value = clean(text)
    const items = this.list()
    // The same fact twice is one memory.
    const same = items.find((m) => m.text.toLowerCase() === value.toLowerCase())
    if (same) return same
    const now = Date.now()
    const item: MemoryItem = { id: randomUUID().slice(0, 8), text: value, source, createdAt: now, updatedAt: now }
    this.items = [...items, item].slice(-MAX_MEMORIES)
    this.save()
    return item
  }

  update(id: string, text: string, source?: string): MemoryItem {
    const item = this.get(id)
    if (!item) throw new Error(`No memory with id ${id}`)
    item.text = clean(text)
    item.updatedAt = Date.now()
    if (source) item.source = source
    this.save()
    return item
  }

  remove(id: string): boolean {
    const items = this.list()
    const next = items.filter((m) => m.id !== id)
    if (next.length === items.length) return false
    this.items = next
    this.save()
    return true
  }

  clear(): void {
    this.items = []
    this.save()
  }

  private save(): void {
    writeJson(this.path(), this.list())
    this.emit('changed', this.list())
  }
}

export const memoryStore = new MemoryStore()

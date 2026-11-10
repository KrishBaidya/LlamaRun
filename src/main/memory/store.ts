import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { MemoryItem, MemoryKind } from '@shared/types'
import { readJson, writeJson } from '../jsonFile'
import { userDataPath } from '../paths'

/** Longest single memory; facts, not documents. */
export const MAX_MEMORY_CHARS = 500
/** Memories kept; past this the oldest go first. They are all sent with every message. */
export const MAX_MEMORIES = 200
/**
 * Characters each kind may fill, since every message carries them (Hermes keeps
 * about 1,375 and 2,200). The model has to merge or drop entries to make room;
 * memories the user adds always go in.
 */
export const MEMORY_BUDGET: Record<MemoryKind, number> = { user: 1400, note: 2200 }

function clean(text: string): string {
  const value = text.replace(/\s+/g, ' ').trim()
  if (!value) throw new Error('A memory needs some text')
  if (value.length > MAX_MEMORY_CHARS) throw new Error(`Keep a memory under ${MAX_MEMORY_CHARS} characters`)
  return value
}

/** A memory's kind; older memories have none, and those about the user start with "User". */
export const kindOf = (m: Pick<MemoryItem, 'kind' | 'text'>): MemoryKind => m.kind ?? (/^(the )?user\b/i.test(m.text) ? 'user' : 'note')

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

  /** Characters the memories of a kind fill now. */
  used(kind: MemoryKind, except?: string): number {
    return this.list()
      .filter((m) => kindOf(m) === kind && m.id !== except)
      .reduce((n, m) => n + m.text.length, 0)
  }

  /** The model (or a plugin) can't fill a kind past its budget: it has to make room first. */
  private fits(kind: MemoryKind, length: number, source: string, except?: string): void {
    if (source === 'user') return
    const used = this.used(kind, except)
    if (used + length > MEMORY_BUDGET[kind]) {
      const what = kind === 'user' ? 'about the user' : 'notes'
      throw new Error(`Memories ${what} are full (${used} of ${MEMORY_BUDGET[kind]} characters). Merge entries with memory_update or remove some with memory_forget, then save again.`)
    }
  }

  add(text: string, source: string, kind?: MemoryKind): MemoryItem {
    const value = clean(text)
    const items = this.list()
    // The same fact twice is one memory.
    const same = items.find((m) => m.text.toLowerCase() === value.toLowerCase())
    if (same) return same
    const k = kind ?? kindOf({ text: value })
    this.fits(k, value.length, source)
    const now = Date.now()
    const item: MemoryItem = { id: randomUUID().slice(0, 8), text: value, source, kind: k, createdAt: now, updatedAt: now }
    this.items = [...items, item].slice(-MAX_MEMORIES)
    this.save()
    return item
  }

  update(id: string, text: string, source?: string): MemoryItem {
    const item = this.get(id)
    if (!item) throw new Error(`No memory with id ${id}`)
    const value = clean(text)
    this.fits(kindOf(item), value.length, source ?? item.source, item.id)
    item.text = value
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

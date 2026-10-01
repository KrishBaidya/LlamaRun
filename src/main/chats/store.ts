import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Chat, ChatSummary } from '@shared/types'
import { readJson, writeJson } from '../jsonFile'
import { userDataPath } from '../paths'

const TITLE_LENGTH = 60

export function titleFrom(text: string): string {
  const line = text.trim().split(/\r?\n/)[0].replace(/\s+/g, ' ').trim()
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : line || 'New chat'
}

/** Persists each chat as userData/chats/<id>.json, cached in memory. */
class ChatStore extends EventEmitter<{ changed: [] }> {
  private chats: Map<string, Chat> | null = null

  private get dir(): string {
    return userDataPath('chats')
  }

  private all(): Map<string, Chat> {
    if (this.chats) return this.chats
    this.chats = new Map()
    mkdirSync(this.dir, { recursive: true })
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue
      const chat = readJson<Chat | null>(join(this.dir, file), null)
      if (chat?.id && Array.isArray(chat.messages)) {
        // A crash mid-stream leaves "streaming" messages behind; close them out.
        for (const m of chat.messages) if (m.status === 'streaming') m.status = 'cancelled'
        // Paused tool runs live in memory only, so they can't be continued after a restart.
        for (const m of chat.messages) delete m.toolLimit
        this.chats.set(chat.id, chat)
      }
    }
    return this.chats
  }

  summaries(isGenerating: (id: string) => boolean): ChatSummary[] {
    return [...this.all().values()]
      .filter((c) => c.messages.length > 0 && !c.ephemeral)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => {
        const last = [...c.messages].reverse().find((m) => m.content)
        return {
          id: c.id,
          title: c.title,
          model: c.model,
          updatedAt: c.updatedAt,
          messageCount: c.messages.length,
          preview: (last?.content ?? '').slice(0, 120),
          generating: isGenerating(c.id)
        }
      })
  }

  get(id: string): Chat | undefined {
    return this.all().get(id)
  }

  create(model: string, ephemeral = false): Chat {
    const now = Date.now()
    const chat: Chat = { id: randomUUID(), title: 'New chat', model, createdAt: now, updatedAt: now, messages: [] }
    if (ephemeral) chat.ephemeral = true
    this.all().set(chat.id, chat)
    return chat
  }

  /** Writes to disk. Empty chats are kept in memory only until they get a message. */
  save(chat: Chat, touch = true): void {
    if (touch) chat.updatedAt = Date.now()
    this.all().set(chat.id, chat)
    if (chat.ephemeral) return
    if (chat.messages.length) writeJson(join(this.dir, `${chat.id}.json`), chat)
    this.emit('changed')
  }

  delete(id: string): void {
    this.all().delete(id)
    rmSync(join(this.dir, `${id}.json`), { force: true })
    this.emit('changed')
  }
}

export const chatStore = new ChatStore()

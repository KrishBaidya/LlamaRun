import type { Chat, ChatMessage } from '@shared/types'
import { chatStore } from './store'

/**
 * Searching past chats, like Hermes' session_search: the model finds how a task
 * went before (what worked, what the user said) instead of asking again. Chats
 * are all in memory already, so this is a scan, not an index.
 */

const SNIPPET = 240
/** Most characters of one message chat_read shows. */
const READ_MESSAGE_CHARS = 1500

export interface ChatHit {
  chatId: string
  title: string
  updatedAt: number
  /** 1-based message number, for chat_read's around. */
  message: number
  role: ChatMessage['role']
  snippet: string
}

/** What a message says for searching and reading: its text, then the tools it used. */
function messageText(m: ChatMessage): string {
  const tools = (m.parts ?? []).flatMap((p) => (p.type === 'tool' ? [p.name] : []))
  return [m.content, tools.length ? `(tools: ${[...new Set(tools)].join(', ')})` : ''].filter(Boolean).join(' ')
}

const termsOf = (query: string): string[] => [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1))]

function snippetAt(text: string, index: number): string {
  const start = Math.max(0, index - SNIPPET / 3)
  const piece = text.slice(start, start + SNIPPET).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${piece}${start + SNIPPET < text.length ? '…' : ''}`
}

/** Chats whose messages match the most terms of the query, best first, newer first on ties; one hit per chat. */
export function searchChats(query: string, options: { exclude?: string; limit?: number; chats?: Iterable<Chat> } = {}): ChatHit[] {
  const terms = termsOf(query)
  if (!terms.length) return []
  const phrase = query.trim().toLowerCase()
  const hits: (ChatHit & { score: number })[] = []
  for (const chat of options.chats ?? chatStore.everyChat()) {
    if (chat.ephemeral || chat.id === options.exclude || !chat.messages.length) continue
    let best: (ChatHit & { score: number }) | null = null
    chat.messages.forEach((m, i) => {
      const text = messageText(m)
      const lower = text.toLowerCase()
      const matched = terms.filter((t) => lower.includes(t))
      if (!matched.length) return
      const score = matched.length * 10 + (lower.includes(phrase) ? 15 : 0) + (chat.title.toLowerCase().includes(terms[0]) ? 3 : 0)
      if (best && score <= best.score) return
      best = { chatId: chat.id, title: chat.title, updatedAt: chat.updatedAt, message: i + 1, role: m.role, snippet: snippetAt(text, lower.indexOf(matched[0])), score }
    })
    if (best) hits.push(best)
  }
  return hits
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
    .slice(0, options.limit ?? 8)
    .map(({ score: _score, ...hit }) => hit)
}

const day = (t: number): string => new Date(t).toISOString().slice(0, 10)

export function formatHits(query: string, hits: ChatHit[]): string {
  if (!hits.length) return `No earlier chat mentions "${query}".`
  return [
    `Earlier chats about "${query}" (read one with chat_read):`,
    ...hits.map((h, i) => `${i + 1}. "${h.title}" (${day(h.updatedAt)}, chat ${h.chatId}, message ${h.message}, ${h.role}): ${h.snippet}`)
  ].join('\n')
}

/** A window of a chat's messages around one, for chat_read. */
export function readChat(chatId: string, around?: number, count = 8): string {
  const chat = chatStore.get(chatId.trim())
  if (!chat || chat.ephemeral) throw new Error(`No saved chat ${chatId}`)
  const total = chat.messages.length
  const center = Math.min(Math.max(1, Math.floor(around ?? 1)), total)
  const from = Math.max(1, around ? center - Math.floor(count / 2) : 1)
  const to = Math.min(total, from + count - 1)
  const lines = chat.messages.slice(from - 1, to).map((m, i) => {
    const text = messageText(m)
    return `[${from + i}. ${m.role}] ${text.length > READ_MESSAGE_CHARS ? `${text.slice(0, READ_MESSAGE_CHARS)}…` : text}`
  })
  const more = to < total ? `\n(${total - to} later messages: chat_read with around ${Math.min(total, to + Math.ceil(count / 2))})` : ''
  return `"${chat.title}" (${day(chat.updatedAt)}), messages ${from}-${to} of ${total}:\n${lines.join('\n')}${more}`
}

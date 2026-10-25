import type { ChatCompaction, ChatMessage } from '@shared/types'

/**
 * Compaction, as Claude Code does it: when a chat nears its model's context
 * window (or on /compact), the older messages are summarised by the chat's own
 * model and the model sees that summary plus the last few turns from then on.
 * The full messages stay on screen and on disk.
 */

export const SUMMARY_INTRO = 'Summary of our conversation so far (older messages were compacted to save space):'

export const COMPACT_SYSTEM = `You are compacting a conversation between a user and an AI assistant so it can continue in a smaller context window. Write a summary that lets the assistant carry on as if it remembered everything important. Use these headings, skipping any that are empty:

## User and goals
Who the user is and what they are trying to do overall.
## Key facts and decisions
Facts, numbers, names, preferences, choices made and why. Keep exact values (dates, amounts, file names, code identifiers, URLs).
## Files and attachments
Documents or images the user shared and what mattered in them.
## Work done so far
What has been answered, produced or tried, including tool results that still matter.
## Open threads
Questions not yet answered, next steps, anything promised.

Write in English unless the conversation is in another language. Be thorough but concise; drop small talk and anything superseded. Output only the summary.`

/** Messages a compaction covers, and the ones kept word for word (from the Nth-last user turn on). */
export function splitForCompaction(
  messages: ChatMessage[],
  keepTurns: number,
  previous?: ChatCompaction
): { older: ChatMessage[]; kept: ChatMessage[] } | null {
  const start = previous ? messages.findIndex((m) => m.id === previous.throughMessageId) + 1 : 0
  const userIdx = messages.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= start)
  const keep = Math.max(1, keepTurns)
  if (userIdx.length <= keep) return null
  const cut = userIdx[userIdx.length - keep]
  const older = messages.slice(start, cut).filter((m) => m.content || m.attachments?.length)
  if (!older.length) return null
  return { older, kept: messages.slice(cut) }
}

/** The older messages as text for the summariser, newest kept when it must be cut to fit. */
export function transcriptOf(messages: ChatMessage[], previousSummary: string | undefined, maxChars: number): string {
  const lines = messages.map((m) => {
    const who = m.role === 'user' ? 'User' : m.from ? `Plugin ${m.from.plugin}` : 'Assistant'
    const files = (m.attachments ?? []).map((a) => `[${a.kind === 'image' ? 'image' : 'document'}: ${a.name}]`)
    const docs = (m.attachments ?? [])
      .filter((a) => a.kind === 'document' && a.text)
      .map((a) => `<document name="${a.name}">\n${a.text!.slice(0, 6000)}\n</document>`)
    const tools = m.tools?.length ? ` (used tools: ${m.tools.map((t) => t.name).join(', ')})` : ''
    return [`${who}${tools}: ${m.prompt ?? m.content}`, ...files, ...docs].join('\n')
  })
  let body = lines.join('\n\n')
  if (body.length > maxChars) body = `[…earlier part cut…]\n${body.slice(body.length - maxChars)}`
  return previousSummary ? `Earlier summary:\n${previousSummary}\n\nConversation since then:\n${body}` : body
}

export function compactionRequest(transcript: string, instructions?: string): string {
  const focus = instructions?.trim() ? `\n\nThe user asked the summary to focus on: ${instructions.trim()}` : ''
  return `Here is the conversation to summarise.${focus}\n\n<conversation>\n${transcript}\n</conversation>`
}

/** Messages the model sees: after a compaction, the summary turn and only what came after it. */
export function visibleMessages(messages: ChatMessage[], compaction?: ChatCompaction): { summary?: string; messages: ChatMessage[] } {
  if (!compaction) return { messages }
  const idx = messages.findIndex((m) => m.id === compaction.throughMessageId)
  if (idx < 0) return { messages }
  return { summary: compaction.summary, messages: messages.slice(idx + 1) }
}

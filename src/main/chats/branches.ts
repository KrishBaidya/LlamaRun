import type { ChatMessage, MessageVersion } from '@shared/types'

/**
 * Editing an earlier message forks the chat there, like Claude Code's /rewind,
 * Gemini CLI's /restore and ChatGPT's edit: the edited message starts a new
 * branch and the old one is kept, so ‹ 1/2 › switches between them. Each user
 * message that was edited carries its versions; the active one's messages are
 * the chat's (the stored copy of its tail is refreshed when it's switched
 * away from), so the model only ever sees the active branch.
 */

function snapshot(m: ChatMessage, tail: ChatMessage[]): MessageVersion {
  return {
    content: m.content,
    ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    ...(m.skill ? { skill: m.skill } : {}),
    createdAt: m.createdAt,
    tail
  }
}

/** Index of a user message, or an error saying why it can't be changed. */
function userIndex(messages: ChatMessage[], messageId: string): number {
  const i = messages.findIndex((m) => m.id === messageId)
  if (i < 0) throw new Error('That message is no longer in this chat')
  if (messages[i].role !== 'user') throw new Error('Only your own messages can be edited')
  return i
}

/**
 * The chat's messages after editing one: everything before it, then the
 * edited message (with the old text and its replies kept as a version) as the
 * newest message, ready for a new reply.
 */
export function editMessage(messages: ChatMessage[], messageId: string, text: string): { messages: ChatMessage[]; dropped: ChatMessage[] } {
  const i = userIndex(messages, messageId)
  const m = messages[i]
  const tail = messages.slice(i + 1)
  const versions = [...(m.versions ?? [])]
  const active = m.version ?? 0
  if (!versions.length) versions.push(snapshot(m, tail))
  else versions[active] = snapshot(m, tail)
  const edited: ChatMessage = {
    ...m,
    content: text,
    prompt: undefined,
    skill: undefined,
    status: 'done',
    createdAt: Date.now(),
    versions: [...versions, { content: text, createdAt: Date.now(), tail: [] }],
    version: versions.length
  }
  return { messages: [...messages.slice(0, i), edited], dropped: tail }
}

/** The chat's messages showing another version of an edited message, with the replies it had. */
export function switchVersion(messages: ChatMessage[], messageId: string, index: number): ChatMessage[] {
  const i = userIndex(messages, messageId)
  const m = messages[i]
  const versions = [...(m.versions ?? [])]
  if (index < 0 || index >= versions.length) throw new Error('No such version')
  const active = m.version ?? versions.length - 1
  if (index === active) return messages
  versions[active] = snapshot(m, messages.slice(i + 1))
  const target = versions[index]
  const shown: ChatMessage = {
    ...m,
    content: target.content,
    attachments: target.attachments,
    skill: target.skill,
    prompt: undefined,
    createdAt: target.createdAt,
    versions,
    version: index
  }
  return [...messages.slice(0, i), shown, ...target.tail]
}

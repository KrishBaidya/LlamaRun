import type { Chat, ChatMessage, TaskSuggestions } from '@shared/types'
import { generate, modelCatalog } from '../llm'
import { isCloudModel } from '../llm/models'
import { memoryStore } from '../memory/store'
import { skillStore } from '../skills/store'
import { replyForModel } from './parts'

/**
 * The review after a long task, like Hermes' background review: a cheap model
 * reads what just happened and proposes at most one skill and two memories.
 * They are shown under the reply; nothing is kept until the user says so. The
 * instructions here go to the reviewer, not to the model doing the task.
 */

/** Most characters of the task the reviewer reads. */
const MAX_TRANSCRIPT = 12_000

export const REVIEW_SYSTEM = [
  "You review a finished task from a desktop assistant's chat and decide whether anything should be kept for later chats.",
  'Reply with JSON only, no prose: {"skill": null or {"name": string, "description": string, "body": string}, "memories": [{"text": string, "kind": "user" or "note"}]}.',
  'Propose a skill only when the task took several steps and a reusable procedure came out of it: "description" says in one line what it does and when to use it; "body" is Markdown with the steps that worked, the pitfalls that were hit, and how to check the result. Skip it when an existing skill already covers the task.',
  'Propose memories only for lasting facts: about the user ("kind": "user", starting with "User") or about their setup and what works there ("kind": "note"). Skip anything already remembered, anything about this task only, and secrets.',
  'At most one skill and two memories. When nothing is worth keeping, reply {"skill": null, "memories": []}.'
].join('\n')

/** The user's request and what the reply did, tool calls included, cut to fit. */
export function taskTranscript(chat: Chat, assistant: ChatMessage): string {
  const index = chat.messages.indexOf(assistant)
  const user = [...chat.messages.slice(0, index)].reverse().find((m) => m.role === 'user')
  const text = `User asked:\n${user?.skill ? `${user.content}\n${user.skill.instructions}` : (user?.content ?? '')}\n\nAssistant did:\n${replyForModel(assistant, true)}`
  return text.length > MAX_TRANSCRIPT ? `${text.slice(0, MAX_TRANSCRIPT / 2)}\n…\n${text.slice(-MAX_TRANSCRIPT / 2)}` : text
}

/** The reviewer's JSON as suggestions, leaving out anything malformed. */
export function parseSuggestions(reply: string): TaskSuggestions | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let data: { skill?: unknown; memories?: unknown }
  try {
    data = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
  const s = data.skill as Record<string, unknown> | null | undefined
  const skill =
    s && typeof s.name === 'string' && typeof s.description === 'string' && typeof s.body === 'string' && s.name.trim() && s.body.trim()
      ? { name: s.name.trim().slice(0, 64), description: s.description.trim().slice(0, 300), body: s.body.trim().slice(0, 8000) }
      : undefined
  const memories = (Array.isArray(data.memories) ? data.memories : [])
    .map((m) => m as { text?: unknown; kind?: unknown })
    .filter((m) => typeof m.text === 'string' && m.text.trim())
    .slice(0, 2)
    .map((m) => ({ text: String(m.text).trim().slice(0, 500), kind: m.kind === 'user' ? ('user' as const) : ('note' as const) }))
  if (!skill && !memories.length) return null
  return { ...(skill ? { skill } : {}), ...(memories.length ? { memories } : {}) }
}

/** A cheap cloud model for the review when the chat runs in the cloud; the chat's own model otherwise. */
async function reviewModel(chatModel: string): Promise<string> {
  if (!isCloudModel(chatModel)) return chatModel
  const catalog = await modelCatalog().catch(() => null)
  const fast = catalog?.groups.flatMap((g) => g.models).find((m) => m.cloud && m.capabilities?.includes('fast'))
  return fast?.id ?? chatModel
}

/** Runs the review; null when there is nothing to propose. */
export async function reviewTask(chat: Chat, assistant: ChatMessage, chatModel: string): Promise<TaskSuggestions | null> {
  const skills = skillStore.list().map((s) => `- ${s.name}: ${s.description.slice(0, 120)}`)
  const memories = memoryStore.list().map((m) => `- ${m.text}`)
  const prompt = [
    taskTranscript(chat, assistant),
    `\nExisting skills:\n${skills.join('\n') || '(none)'}`,
    `\nAlready remembered:\n${memories.join('\n') || '(nothing)'}`
  ].join('\n')
  const reply = await generate(prompt, { model: await reviewModel(chatModel), system: REVIEW_SYSTEM })
  const suggestions = parseSuggestions(reply)
  if (!suggestions?.memories) return suggestions
  // The reviewer sometimes repeats what's already kept.
  const known = new Set(memoryStore.list().map((m) => m.text.toLowerCase()))
  const fresh = suggestions.memories.filter((m) => !known.has(m.text.toLowerCase()))
  return fresh.length || suggestions.skill ? { ...(suggestions.skill ? { skill: suggestions.skill } : {}), ...(fresh.length ? { memories: fresh } : {}) } : null
}

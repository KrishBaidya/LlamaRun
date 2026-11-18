import type { ApprovalAnswer, ApprovalRequest } from '@shared/types'

/**
 * A messaging app Llama Run can be reached through, like Hermes' and
 * OpenClaw's gateways: the user's own bot, paired with their own account.
 */

export type ChannelId = 'telegram' | 'discord'

/** What a channel tells the bridge. */
export interface ChannelEvents {
  /** A message from someone: the bridge pairs them or runs it in their chat. */
  message: (peer: string, name: string, text: string) => void
  /** A button under an approval or question was pressed. */
  answer: (approvalId: string, answer: ApprovalAnswer | { text: string }) => void
}

export interface Channel {
  id: ChannelId
  /** Starts listening with the bot token; resolves once connected (or throws). */
  start(token: string, events: ChannelEvents): Promise<{ botName: string }>
  stop(): void
  /** A message to a peer, split as the app needs. */
  send(peer: string, text: string): Promise<void>
  /** An approval or question as a message with buttons. */
  ask(peer: string, request: ApprovalRequest): Promise<void>
  /** Shows that a reply is being made. */
  typing(peer: string): Promise<void>
}

/** Splits text into pieces of at most `max` characters, at line breaks where it can. */
export function chunks(text: string, max: number): string[] {
  const out: string[] = []
  let rest = text.trim() || '(empty reply)'
  while (rest.length > max) {
    let at = rest.lastIndexOf('\n', max)
    if (at < max / 2) at = rest.lastIndexOf(' ', max)
    if (at < max / 2) at = max
    out.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  out.push(rest)
  return out
}

/** The buttons for an approval: what the desktop card offers. */
export function approvalButtons(request: ApprovalRequest): { label: string; answer: ApprovalAnswer | { text: string } }[] {
  if (request.kind === 'question') return (request.options ?? []).map((o) => ({ label: o, answer: { text: o } }))
  return [
    { label: 'Allow once', answer: 'once' as const },
    ...(request.chatLabel ? [{ label: request.chatLabel, answer: 'chat' as const }] : []),
    ...(request.alwaysLabel ? [{ label: request.alwaysLabel, answer: 'always' as const }] : []),
    { label: 'Deny', answer: 'deny' as const }
  ]
}

/** An approval as text for a chat app. */
export function approvalText(request: ApprovalRequest): string {
  if (request.kind === 'question') return `❓ ${request.title}${request.other !== false ? '\n(Or reply with your own answer.)' : ''}`
  return `🔐 ${request.title}\n\n${request.command}${request.detail ? `\n\n${request.detail}` : ''}`
}

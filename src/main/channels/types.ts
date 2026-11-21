import type { ApprovalAnswer, ApprovalRequest } from '@shared/types'

/**
 * A messaging app Llama Run can be reached through, like Hermes' and
 * OpenClaw's gateways: the user's own bot, used only by people they allowed.
 */

export type ChannelId = 'telegram' | 'discord'

/** Who sent a message: their chat id with the bot, display name and @username. */
export interface Sender {
  peer: string
  name: string
  username?: string
}

/** A photo or file someone sent, already downloaded. */
export interface IncomingFile {
  kind: 'image' | 'document'
  name: string
  mimeType: string
  bytes: Uint8Array
}

/** What came with a message besides its text. */
export interface MessageExtra {
  /** The app's id for the message, to react to it. */
  messageId?: string
  files?: IncomingFile[]
}

/** One entry of the bot's / menu. */
export interface BotCommand {
  command: string
  description: string
  /** A skill pack: the skills it opens (apps with options pick one of them). */
  pack?: string[]
  /** A skill, MCP prompt or plugin command: words after it are what it works on. */
  takesText?: boolean
}

/** What a channel tells the bridge. */
export interface ChannelEvents {
  /** A message from someone: the bridge asks the user about them or runs it in their chat. */
  message: (from: Sender, text: string, extra?: MessageExtra) => void
  /** A button under an approval or question was pressed. */
  answer: (approvalId: string, answer: ApprovalAnswer | { text: string }) => void
  /** A button from `choose` was pressed. */
  choice?: (peer: string, value: string) => void
  /** Suggestions while someone types a slash command's option (Discord): only allowed people get any. */
  complete?: (peer: string, option: string, value: string) => Promise<{ name: string; value: string }[]>
}

export interface Channel {
  id: ChannelId
  /** Longest message the app takes (default 3500). */
  maxMessage?: number
  /** The app has a / menu per person (Telegram), so allowed people's menus can list their skills. */
  personalMenus?: boolean
  /** Starts listening with the bot token; resolves once connected (or throws). */
  start(token: string, events: ChannelEvents): Promise<{ botName: string }>
  stop(): void
  /** A message to a peer as plain text, split as the app needs. */
  send(peer: string, text: string): Promise<void>
  /** An approval or question as a message with buttons. */
  ask(peer: string, request: ApprovalRequest): Promise<void>
  /** Shows that a reply is being made. */
  typing(peer: string): Promise<void>
  /**
   * Sets the / menu one person sees (null: everyone's default menu); an empty
   * list removes it. Resolves with how many commands the app reports back, when it can check.
   */
  setCommands?(commands: BotCommand[], peer: string | null): Promise<number | void>
  /** A reply written in Markdown, shown formatted where the app can (falls back to plain text). */
  sendFormatted?(peer: string, markdown: string): Promise<void>
  /** Starts a message that `edit` keeps changing as a reply streams; returns its id. */
  draft?(peer: string, text: string): Promise<string>
  /** Changes a draft; `final` shows it formatted. */
  edit?(peer: string, messageId: string, text: string, final: boolean): Promise<void>
  /** Removes a message the bot sent. */
  remove?(peer: string, messageId: string): Promise<void>
  /** Sends an image file. */
  sendImage?(peer: string, path: string, caption?: string): Promise<void>
  /** Reacts to someone's message with an emoji. */
  react?(peer: string, messageId: string, emoji: string): Promise<void>
  /** A message with buttons; pressing one calls events.choice with its value. */
  choose?(peer: string, text: string, options: { label: string; value: string }[]): Promise<void>
  /** The bot's profile texts: shown before anyone starts a chat with it. */
  setProfile?(description: string, short: string): Promise<void>
  /** Links that help set it up (add the bot to a server, open a chat with it), once connected. */
  setupLinks?(): { label: string; url: string }[]
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

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The model's Markdown as Telegram's HTML subset: code blocks, inline code,
 * bold, italics, strikethrough, links and headings (as bold). Everything else
 * stays as text, escaped, so a stray < or & can't break the message.
 */
export function toTelegramHtml(markdown: string): string {
  const stash: string[] = []
  const keep = (html: string): string => `\u0000${stash.push(html) - 1}\u0000`
  let s = markdown.replace(/```[\w+-]*\n?([\s\S]*?)```/g, (_m, code: string) => keep(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`))
  s = s.replace(/`([^`\n]+)`/g, (_m, code: string) => keep(`<code>${escapeHtml(code)}</code>`))
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => keep(`<a href="${escapeHtml(url).replace(/"/g, '&quot;')}">${escapeHtml(label)}</a>`))
  s = escapeHtml(s)
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<b>$1</b>')
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<i>$2</i>').replace(/(^|[^_\w])_([^_\n]+)_(?=[^_\w]|$)/g, '$1<i>$2</i>')
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
  s = s.replace(/^(\s*)[-*]\s+/gm, '$1• ')
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => stash[Number(i)])
}

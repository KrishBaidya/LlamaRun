import { BrowserWindow, Notification } from 'electron'
import { approvals } from './assistant/approval'
import { iconPath } from './paths'
import { settings } from './settings'
import { openChatWindow } from './windows/chat'

/**
 * Tells the user when something in a chat needs them while they're in another
 * app: a reply that ran tools has finished, or a chat is waiting for an
 * approval. Nothing shows while a Llama Run window has focus, so they're
 * never told about what they're looking at.
 */

const enabled = (): boolean => settings.get('notifyWhenDone') !== false
const away = (): boolean => typeof BrowserWindow?.getFocusedWindow === 'function' && !BrowserWindow.getFocusedWindow()

export function show(chatId: string, title: string, body: string): void {
  if (typeof Notification?.isSupported !== 'function' || !Notification.isSupported()) return
  const note = new Notification({ title, body: body.slice(0, 200), icon: iconPath() })
  note.on('click', () => openChatWindow(chatId))
  note.show()
}

const gist = (text: string): string => text.replace(/[#*`_>|[\]]/g, '').replace(/\s+/g, ' ').trim()

/** A typed reply that used tools has finished (or failed) while the user was elsewhere. */
export function replyFinished(chatId: string, title: string, status: string, content: string, error?: string): void {
  if (!enabled() || !away()) return
  if (status === 'error') show(chatId, `${title || 'Chat'}: something went wrong`, error ?? 'The reply failed.')
  else if (status === 'done') show(chatId, `${title || 'Chat'}: done`, gist(content) || 'The reply has finished.')
}

/** Approvals a notification was shown for, so one question notifies once. */
const told = new Set<string>()

/** Watches the approval queue: a question while the user is away gets a notification. */
export function startApprovalNotices(titleOf: (chatId: string) => string): void {
  approvals.on('changed', (chatId, request) => {
    if (!request || told.has(request.id) || approvals.unattended.has(chatId) || !enabled() || !away()) return
    told.add(request.id)
    if (told.size > 200) told.delete(told.values().next().value!)
    const what = request.kind === 'question' ? request.title : `${request.title} ${request.command}`.trim()
    show(chatId, `${titleOf(chatId) || 'Chat'} needs you`, what)
  })
}

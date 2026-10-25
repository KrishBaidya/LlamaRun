import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { BrowserWindow, dialog } from 'electron'
import type { ApprovalAnswer, ApprovalRequest } from '@shared/types'
import { iconPath } from '../paths'

export type Approval = ApprovalAnswer

/**
 * Asks before the model runs something on the user's PC, like Claude Code's
 * permission prompt: allow this once, always allow it, or deny. The question
 * appears as a card in the chat that asked (see MessageList); a chat has at
 * most one open question, and stopping the reply denies it.
 */
class Approvals extends EventEmitter<{ changed: [chatId: string, request: ApprovalRequest | null] }> {
  private pending = new Map<string, { chatId: string; request: ApprovalRequest; resolve: (a: Approval) => void }>()
  private queues = new Map<string, Promise<unknown>>()

  ask(chatId: string, request: Omit<ApprovalRequest, 'id'>): Promise<Approval> {
    const run = (): Promise<Approval> =>
      new Promise((resolve) => {
        const full: ApprovalRequest = { id: randomUUID(), ...request }
        this.pending.set(full.id, { chatId, request: full, resolve })
        this.emit('changed', chatId, full)
      })
    const previous = this.queues.get(chatId) ?? Promise.resolve()
    const result = previous.then(run, run)
    this.queues.set(chatId, result.catch(() => {}))
    return result
  }

  answer(id: string, answer: Approval): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    this.emit('changed', entry.chatId, null)
    entry.resolve(answer)
  }

  /** The open question for a chat, so a window that opens later can show it. */
  current(chatId: string): ApprovalRequest | null {
    for (const entry of this.pending.values()) if (entry.chatId === chatId) return entry.request
    return null
  }

  /** The reply was stopped: deny whatever it was waiting for. */
  cancelChat(chatId: string): void {
    for (const [id, entry] of this.pending) if (entry.chatId === chatId) this.answer(id, 'deny')
  }
}

export const approvals = new Approvals()

/** Outside a chat (no card to show), a native dialog asks instead. */
async function askNative(request: Omit<ApprovalRequest, 'id'>): Promise<Approval> {
  const parent = BrowserWindow.getFocusedWindow() ?? undefined
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    title: request.title,
    message: request.title,
    detail: request.detail,
    buttons: ['Allow once', request.alwaysLabel, 'Deny'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    icon: iconPath()
  }
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  return response === 0 ? 'once' : response === 1 ? 'always' : 'deny'
}

export function askApproval(chatId: string | undefined, request: Omit<ApprovalRequest, 'id'>): Promise<Approval> {
  return chatId ? approvals.ask(chatId, request) : askNative(request)
}

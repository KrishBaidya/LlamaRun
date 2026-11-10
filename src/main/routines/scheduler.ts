import { Notification } from 'electron'
import type { Routine } from '@shared/types'
import { approvals } from '../assistant/approval'
import { chatService } from '../chats/service'
import { iconPath } from '../paths'
import { openChatWindow } from '../windows/chat'
import { routineStore } from './store'
import { parseWhen } from './parse'

/**
 * Runs routines when they're due, while Llama Run is open (it lives in the
 * tray). Each run is a turn in the routine's own chat, with nobody to answer:
 * approvals are denied at once, so only commands the user's rules allow run,
 * and computer use is off. A routine missed while the app was closed runs once
 * when it starts. The result shows as a notification and stays in the chat.
 */

const TICK_MS = 60_000
const running = new Set<string>()
let timer: NodeJS.Timeout | null = null

/** The first line or so of a reply, for a notification. */
const gist = (text: string): string => {
  const line = text.replace(/[#*`>_]/g, '').replace(/\s+/g, ' ').trim()
  return line.length > 180 ? `${line.slice(0, 177)}…` : line || 'Done.'
}

export async function runRoutine(routine: Routine): Promise<void> {
  if (running.has(routine.id)) return
  running.add(routine.id)
  // Due again only from now on, whatever happens to this run.
  const schedule = (() => {
    try {
      return parseWhen(routine.when)
    } catch {
      return null
    }
  })()
  routineStore.update(routine.id, { next: schedule && !schedule.once ? schedule.next(new Date()) : null, lastRun: Date.now() })
  let chatId = routine.chatId
  try {
    if (chatId) approvals.unattended.add(chatId)
    const started = chatService.ask(chatId ?? null, routine.prompt, { model: routine.model, turn: { routine: true } })
    chatId = started.chatId
    approvals.unattended.add(chatId)
    if (!routine.chatId) routineStore.update(routine.id, { chatId })
    const reply = await started.done
    const status = reply.status === 'done' ? 'done' : reply.status === 'cancelled' ? 'stopped' : 'error'
    routineStore.update(routine.id, { lastStatus: status })
    const note = new Notification({
      title: `Routine: ${gist(routine.prompt).slice(0, 60)}`,
      body: status === 'error' ? `Failed: ${reply.error ?? 'unknown error'}` : gist(reply.content),
      icon: iconPath()
    })
    const id = chatId
    note.on('click', () => openChatWindow(id))
    note.show()
  } catch {
    routineStore.update(routine.id, { lastStatus: 'error' })
  } finally {
    if (chatId) approvals.unattended.delete(chatId)
    running.delete(routine.id)
  }
}

/** Runs every routine that is due (one run at a time per routine). */
export function tick(now = Date.now()): void {
  for (const r of routineStore.list()) {
    if (!r.paused && r.next !== null && r.next <= now) void runRoutine(r)
  }
}

export function startRoutines(): void {
  if (timer) return
  tick()
  timer = setInterval(() => tick(), TICK_MS)
  // "Run now" and new routines due at once don't wait for the next minute.
  routineStore.on('changed', (list) => {
    if (list.some((r) => !r.paused && r.next !== null && r.next <= Date.now() && !running.has(r.id))) tick()
  })
}

export function stopRoutines(): void {
  if (timer) clearInterval(timer)
  timer = null
}

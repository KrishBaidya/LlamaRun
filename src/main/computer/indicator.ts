import { EventEmitter } from 'node:events'
import { globalShortcut } from 'electron'
import { hudHost } from '../plugins/ui/hud'

const OWNER = 'llamarun.computer'
/** Stops every chat that is using the computer. The agent's keys go to its target window, never through global shortcuts. */
export const STOP_SHORTCUT = 'Control+Alt+Escape'
const STOP_LABEL = 'Ctrl+Alt+Esc'

/**
 * Shows that Llama Run is controlling an app ("Using Notepad"), with a way to
 * stop it: click the card or press Ctrl+Alt+Esc. One card per chat, shown
 * from the first action until the reply ends.
 */
class ComputerIndicator extends EventEmitter<{ stop: [chatId: string] }> {
  private active = new Map<string, string>()

  constructor() {
    super()
    hudHost.handleOwnClicks(OWNER, (chatId) => this.emit('stop', chatId))
  }

  using(chatId: string, app: string): void {
    if (this.active.get(chatId) === app) return
    const first = this.active.size === 0
    this.active.set(chatId, app)
    hudHost.hud(OWNER, 'Computer use', {
      id: chatId,
      op: 'show',
      props: { title: `Llama Run is using ${app}`, text: `Click here or press ${STOP_LABEL} to stop`, indicator: 'pulse', position: 'top' }
    })
    if (first) {
      try {
        globalShortcut.register(STOP_SHORTCUT, () => {
          for (const id of [...this.active.keys()]) this.emit('stop', id)
        })
      } catch {
        // Taken by another app: the card still stops it.
      }
    }
  }

  done(chatId: string): void {
    if (!this.active.delete(chatId)) return
    hudHost.hud(OWNER, 'Computer use', { id: chatId, op: 'hide' })
    if (this.active.size === 0) globalShortcut.unregister(STOP_SHORTCUT)
  }
}

export const indicator = new ComputerIndicator()

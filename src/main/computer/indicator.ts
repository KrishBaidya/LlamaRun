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
  /** Whether Ctrl+Alt+Esc is ours while computer use runs (another app may hold it). */
  private shortcut = false

  constructor() {
    super()
    hudHost.handleOwnClicks(OWNER, (chatId) => this.emit('stop', chatId))
  }

  using(chatId: string, app: string): void {
    if (this.active.get(chatId) === app) return
    if (this.active.size === 0) {
      try {
        // register() returns false (it doesn't throw) when another app holds the shortcut.
        this.shortcut = globalShortcut.register(STOP_SHORTCUT, () => {
          for (const id of [...this.active.keys()]) this.emit('stop', id)
        })
      } catch {
        this.shortcut = false
      }
    }
    this.active.set(chatId, app)
    hudHost.hud(OWNER, 'Computer use', {
      id: chatId,
      op: 'show',
      props: {
        title: `Llama Run is using ${app}`,
        text: this.shortcut ? `Click here or press ${STOP_LABEL} to stop` : 'Click here to stop',
        indicator: 'pulse',
        position: 'top'
      }
    })
  }

  done(chatId: string): void {
    if (!this.active.delete(chatId)) return
    hudHost.hud(OWNER, 'Computer use', { id: chatId, op: 'hide' })
    if (this.active.size === 0 && this.shortcut) {
      globalShortcut.unregister(STOP_SHORTCUT)
      this.shortcut = false
    }
  }
}

export const indicator = new ComputerIndicator()

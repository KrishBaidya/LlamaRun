/**
 * What MCP Apps told the model (ui/update-model-context): each app's latest
 * update per chat, added to that chat's next turns. A new update from the same
 * server replaces its last one, as the spec asks.
 */

const MAX_TEXT = 8_000
const contexts = new Map<string, Map<string, string>>()

export const appContext = {
  set(chatId: string, server: string, text: string): void {
    const byServer = contexts.get(chatId) ?? new Map<string, string>()
    const clean = text.trim().slice(0, MAX_TEXT)
    if (clean) byServer.set(server, clean)
    else byServer.delete(server)
    if (byServer.size) contexts.set(chatId, byServer)
    else contexts.delete(chatId)
  },

  /** The block for a turn's instructions, or '' when no app said anything. */
  text(chatId: string): string {
    const byServer = contexts.get(chatId)
    if (!byServer?.size) return ''
    return [...byServer].map(([server, text]) => `## What the ${server} app shows the user now\n${text}`).join('\n\n')
  },

  clear(chatId: string): void {
    contexts.delete(chatId)
  }
}

import { writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { chatStore } from './store'
import { chatToHtml, chatToMarkdown, exportName } from './export'

/** Asks where to save the chat (Markdown or HTML, by the chosen extension) and writes it. Returns the path, or null if cancelled. */
export async function exportChat(chatId: string): Promise<string | null> {
  const chat = chatStore.get(chatId)
  if (!chat) throw new Error('No such chat')
  const parent = BrowserWindow.getFocusedWindow()
  const options = {
    title: 'Export chat',
    defaultPath: `${app.getPath('documents')}\\${exportName(chat, 'html')}`,
    filters: [
      { name: 'Web page (one file)', extensions: ['html'] },
      { name: 'Markdown', extensions: ['md'] }
    ]
  }
  const { canceled, filePath } = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return null
  const markdown = ['.md', '.markdown'].includes(extname(filePath).toLowerCase())
  writeFileSync(filePath, markdown ? chatToMarkdown(chat) : chatToHtml(chat), 'utf8')
  return filePath
}

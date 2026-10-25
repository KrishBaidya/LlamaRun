import { clipboard, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron'

/** Most spelling suggestions offered, like Windows' own text boxes. */
const MAX_SUGGESTIONS = 5

/**
 * The right-click menu for text: spelling suggestions and "Add to dictionary"
 * on a misspelled word, then Undo, Cut, Copy, Paste and Select all in text
 * boxes, or Copy on selected text. Electron has no menu of its own.
 */
export function attachContextMenu(contents: WebContents): void {
  contents.on('context-menu', (_e, params) => {
    const items: MenuItemConstructorOptions[] = []
    const { editFlags } = params

    if (params.isEditable && params.misspelledWord) {
      const suggestions = params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS)
      if (suggestions.length) {
        for (const word of suggestions) items.push({ label: word, click: () => contents.replaceMisspelling(word) })
      } else {
        items.push({ label: 'No spelling suggestions', enabled: false })
      }
      items.push(
        { label: 'Add to dictionary', click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: 'separator' }
      )
    }

    if (params.isEditable) {
      items.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { role: 'delete', enabled: editFlags.canDelete },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll }
      )
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' }, { role: 'selectAll' })
    }

    if (params.linkURL && /^https?:/i.test(params.linkURL)) {
      if (items.length) items.push({ type: 'separator' })
      items.push({ label: 'Copy link', click: () => clipboard.writeText(params.linkURL) })
    }

    if (!items.length) return
    Menu.buildFromTemplate(items).popup()
  })
}

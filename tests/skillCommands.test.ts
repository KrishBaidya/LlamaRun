import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../src/shared/types'

vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  globalShortcut: {},
  Notification: class {},
  safeStorage: {},
  shell: {}
}))

const { commandName, renderArguments, splitArguments } = await import('../src/main/skills/store')
const { historyFor } = await import('../src/main/chats/service')

describe('skill /commands', () => {
  it('turns skill names into commands', () => {
    expect(commandName('PDF Form Filler')).toBe('pdf-form-filler')
    expect(commandName('seo-audit')).toBe('seo-audit')
  })

  it('splits arguments like a shell', () => {
    expect(splitArguments('report.pdf "Q3 summary" md')).toEqual(['report.pdf', 'Q3 summary', 'md'])
  })

  it('fills $ARGUMENTS, $N, $ARGUMENTS[N] and named arguments', () => {
    expect(renderArguments('Fix issue $ARGUMENTS', '42 urgent')).toBe('Fix issue 42 urgent')
    expect(renderArguments('Convert $0 to $1 ($ARGUMENTS[1])', 'a.docx pdf')).toBe('Convert a.docx to pdf (pdf)')
    expect(renderArguments('Branch $branch for $issue', '7 main', '[issue, branch]')).toBe('Branch main for 7')
  })

  it('appends ARGUMENTS when the skill has no placeholder', () => {
    expect(renderArguments('Do the thing.', 'with care')).toBe('Do the thing.\n\nARGUMENTS: with care')
    expect(renderArguments('Do the thing.', '')).toBe('Do the thing.')
  })

  it('sends the skill instructions to the model instead of the typed command', () => {
    const user: ChatMessage = {
      id: 'u',
      role: 'user',
      content: '/pdf fill form.pdf',
      skill: { name: 'pdf', instructions: '# Skill: pdf\nFill the form.\n\nARGUMENTS: fill form.pdf' },
      status: 'done',
      createdAt: 0
    }
    expect(historyFor([user])[0].content).toContain('Fill the form.')
  })
})

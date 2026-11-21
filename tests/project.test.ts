import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-proj-data-'))
const project = mkdtempSync(join(tmpdir(), 'llamarun-proj-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  nativeImage: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { projectInstructions, validProject } = await import('../src/main/assistant/project')
const { approvals } = await import('../src/main/assistant/approval')
const { callBuiltinTool } = await import('../src/main/assistant/builtins')

describe('project folders', () => {
  it("reads the first instruction file into the prompt, or just says where the chat works", () => {
    expect(projectInstructions(project)).toContain(`This chat works in ${project}`)
    writeFileSync(join(project, 'CLAUDE.md'), 'Use tabs.')
    writeFileSync(join(project, 'AGENTS.md'), 'Run npm test before finishing.')
    const text = projectInstructions(project)
    expect(text).toContain('Its AGENTS.md says:')
    expect(text).toContain('Run npm test before finishing.')
    expect(text).not.toContain('Use tabs.')
    expect(projectInstructions(join(project, 'missing'))).toBe('')
    expect(validProject(join(project, 'AGENTS.md'))).toBeUndefined()
  })

  it('resolves relative paths in the project and uses it without asking', async () => {
    const asked = vi.fn()
    approvals.on('changed', (_c, r) => r && asked(r))
    mkdirSync(join(project, 'src'), { recursive: true })
    const wrote = await callBuiltinTool('write_file', { path: 'src/notes.txt', content: 'hello' }, { chatId: 'c1', project })
    expect(wrote.isError).toBeFalsy()
    expect(readFileSync(join(project, 'src', 'notes.txt'), 'utf8')).toBe('hello')
    const read = await callBuiltinTool('read_file', { path: 'src/notes.txt' }, { chatId: 'c1', project })
    expect(JSON.stringify(read.content)).toContain('hello')
    const grep = await callBuiltinTool('file_grep', { pattern: 'hel+o' }, { chatId: 'c1', project })
    expect(JSON.stringify(grep.content)).toContain('src/notes.txt:1: hello')
    expect(asked).not.toHaveBeenCalled()
    // Without the project, the same relative path is in the skills workspace.
    await callBuiltinTool('write_file', { path: 'scratch.txt', content: 'x' }, { chatId: 'c1' })
    expect(existsSync(join(project, 'scratch.txt'))).toBe(false)
  })
})

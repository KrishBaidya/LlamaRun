import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { formatPage, globFiles, globToRegExp, grepFiles, listDir } from '../src/main/assistant/search'

const root = mkdtempSync(join(tmpdir(), 'llamarun-search-'))
const put = (rel: string, text: string, ageSeconds = 0): void => {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
  const t = Date.now() / 1000 - ageSeconds
  utimesSync(full, t, t)
}
put('report.pdf', '%PDF binary', 50)
put('notes.md', 'todo: buy milk\nnothing here\nTODO: call mom\n', 30)
put('src/app.ts', 'const a = 1\n// TODO fix\nexport {}\n', 10)
put('src/deep/util.ts', 'export const b = 2\n', 5)
put('node_modules/pkg/index.ts', '// TODO hidden\n')
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('globToRegExp', () => {
  it('handles **, *, ? and braces', () => {
    expect(globToRegExp('**/*.ts').test('src/deep/util.ts')).toBe(true)
    expect(globToRegExp('**/*.ts').test('app.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/deep/util.ts')).toBe(false)
    expect(globToRegExp('report.{pdf,docx}').test('report.docx')).toBe(true)
    expect(globToRegExp('n?tes.md').test('notes.md')).toBe(true)
    expect(globToRegExp('a.b').test('axb')).toBe(false)
  })
})

describe('globFiles', () => {
  it('finds by name anywhere, newest first, skipping node_modules', () => {
    const page = globFiles(root, '*.ts')
    expect(page.lines).toEqual(['src/deep/util.ts', 'src/app.ts'])
  })
  it('searches node_modules when the pattern names it', () => {
    expect(globFiles(root, 'node_modules/**/*.ts').lines).toEqual(['node_modules/pkg/index.ts'])
  })
  it('pages', () => {
    const page = globFiles(root, '*', 1, 2)
    expect(page.total).toBe(4)
    expect(page.lines).toHaveLength(2)
    expect(formatPage('Files', page, 1, 'none')).toContain('read on with offset 3')
  })
})

describe('listDir', () => {
  it('puts folders first and shows sizes', () => {
    const page = listDir(root)
    expect(page.lines[0]).toBe('node_modules/')
    expect(page.lines[1]).toBe('src/')
    expect(page.lines).toContain('notes.md (43 B)')
  })
})

describe('grepFiles', () => {
  it('matches lines with path and number, skipping binaries and node_modules', async () => {
    const page = await grepFiles(root, 'TODO')
    expect(page.lines.sort()).toEqual(['notes.md:3: TODO: call mom', 'src/app.ts:2: // TODO fix'])
  })
  it('ignores case and filters by include', async () => {
    const page = await grepFiles(root, 'todo', { ignoreCase: true, include: '*.md' })
    expect(page.lines).toEqual(['notes.md:1: todo: buy milk', 'notes.md:3: TODO: call mom'])
  })
  it('shows context lines', async () => {
    const page = await grepFiles(root, 'call mom', { context: 1 })
    expect(page.lines).toEqual(['notes.md-2- nothing here', 'notes.md:3: TODO: call mom'])
  })
  it('rejects a bad pattern', async () => {
    await expect(grepFiles(root, '(')).rejects.toThrow('regular expression')
  })
})

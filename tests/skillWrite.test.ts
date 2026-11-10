import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'llamarun-skills-'))
const userData = join(root, 'userData')
process.env.LLAMARUN_SKILLS_DIR = join(root, 'skills')
process.env.LLAMARUN_CLAUDE_SKILLS_DIR = join(root, 'claude-skills')

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => process.cwd(), getVersion: () => '0' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  nativeImage: {},
  session: {}
}))

const { builtinTools, callBuiltinTool } = await import('../src/main/assistant/builtins')
const { skillStore } = await import('../src/main/skills/store')
const { learnRequest } = await import('../src/main/chats/service')
const { toolResultToText } = await import('../src/main/llm/toolPayload')
const text = (r: Parameters<typeof toolResultToText>[0]): string => toolResultToText(r)

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('skills the model writes (like Hermes)', () => {
  it('are offered in typed turns even before any skill exists', () => {
    expect(builtinTools({ shell: true }).map((t) => t.name)).toEqual(expect.arrayContaining(['skill_create', 'skill_edit', 'skill_write_file']))
    expect(builtinTools({}).map((t) => t.name)).not.toContain('skill_create')
  })

  it('saves a procedure as a skill that the next chat lists and can load', async () => {
    const r = await callBuiltinTool('skill_create', {
      name: 'Lab Report PDF',
      description: 'Rebuild a lab report PDF with a new name and code.',
      body: '## Steps\n1. read_file the original.\n2. render_html the new page.\n\n## Pitfalls\n- Default PDF fonts have no rupee sign.'
    })
    expect(text(r)).toContain('Saved the skill lab-report-pdf')
    const skill = skillStore.list().find((s) => s.id === 'lab-report-pdf')!
    expect(skill.description).toBe('Rebuild a lab report PDF with a new name and code.')
    expect(skillStore.load('lab-report-pdf')).toContain('Default PDF fonts have no rupee sign.')
    expect(JSON.parse(readFileSync(join(skill.folder, '.llamarun-skill.json'), 'utf8')).createdBy).toBe('model')
    expect(text(await callBuiltinTool('skill_create', { name: 'lab report pdf', description: 'x', body: 'y' }))).toContain('already exists')
  })

  it('improves its own skills, and adds files to them', async () => {
    await callBuiltinTool('skill_edit', { skill: 'lab-report-pdf', old_string: '2. render_html the new page.', new_string: '2. render_html the new page as A4.' })
    expect(skillStore.load('lab-report-pdf')).toContain('render_html the new page as A4.')
    await callBuiltinTool('skill_write_file', { skill: 'lab-report-pdf', path: 'templates/report.html', content: '<h1>{{title}}</h1>' })
    expect(readFileSync(join(process.env.LLAMARUN_SKILLS_DIR!, 'lab-report-pdf', 'templates', 'report.html'), 'utf8')).toBe('<h1>{{title}}</h1>')
    expect(text(await callBuiltinTool('skill_write_file', { skill: 'lab-report-pdf', path: '../escape.txt', content: 'x' }))).toContain('outside the skill')
    expect(existsSync(join(process.env.LLAMARUN_SKILLS_DIR!, 'escape.txt'))).toBe(false)
  })

  it("never changes skills it didn't make", async () => {
    const folder = join(process.env.LLAMARUN_CLAUDE_SKILLS_DIR!, 'docx')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'SKILL.md'), '---\nname: docx\ndescription: Word files\n---\nBody')
    const r = await callBuiltinTool('skill_edit', { skill: 'docx', old_string: 'Body', new_string: 'Changed' })
    expect(text(r)).toContain("wasn't made by Llama Run")
    expect(readFileSync(join(folder, 'SKILL.md'), 'utf8')).toContain('Body')
  })

  it('/learn asks for the chat to be saved as a skill, with an optional focus', () => {
    expect(learnRequest()).toContain('skill_create')
    expect(learnRequest('the PDF fonts')).toContain('Focus on: the PDF fonts')
  })
})

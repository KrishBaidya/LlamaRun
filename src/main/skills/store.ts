import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { delimiter, extname, join, relative, resolve, sep } from 'node:path'
import type { SkillInfo } from '@shared/types'
import { askApproval } from '../assistant/approval'
import { readJson } from '../jsonFile'
import { pythonExecutable, userDataPath } from '../paths'
import { settings } from '../settings'
import { parseFrontMatter } from './frontMatter'

export { parseFrontMatter } from './frontMatter'

export const skillsDir = (): string => userDataPath('Skills')
/** Where skill scripts run, so the files they write end up in one place the user can open. */
export const skillWorkspace = (): string => userDataPath('SkillWorkspace')

/** Written next to an installed skill's SKILL.md. */
export const SKILL_META = '.llamarun-skill.json'

const SKIP = new Set(['.deps', '.git', '__pycache__', 'node_modules', '.venv', SKILL_META])
const MAX_FILES = 300
const SCRIPT_TIMEOUT_MS = 5 * 60_000
const MAX_OUTPUT_CHARS = 16_000
/** SKILL.md bodies and other files the model reads; longer ones are cut with a note. */
const MAX_READ_CHARS = 40_000

export interface SkillMeta {
  source?: string
  installedAt?: number
  requirementsError?: string
}

function listFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || out.length >= MAX_FILES) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(relative(root, full).split(sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

/** Import names whose pip package is called something else. */
const PIP_NAMES: Record<string, string> = {
  fitz: 'pymupdf',
  docx: 'python-docx',
  pptx: 'python-pptx',
  PIL: 'pillow',
  yaml: 'pyyaml',
  cv2: 'opencv-python-headless',
  bs4: 'beautifulsoup4',
  sklearn: 'scikit-learn',
  dateutil: 'python-dateutil'
}

/** The pip package a "No module named 'x'" error asks for, if any. */
export function missingPackage(stderr: string): string | null {
  const m = /ModuleNotFoundError: No module named '([\w.]+)'/.exec(stderr)
  if (!m) return null
  const top = m[1].split('.')[0]
  return PIP_NAMES[top] ?? top
}

/** pip install into <folder>/.deps with the bundled Python; prebuilt wheels only, like plugin installs. */
function pipInstall(folder: string, packages: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((done) => {
    const proc = spawn(
      pythonExecutable(),
      ['-s', '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--only-binary=:all:', '--target', join(folder, '.deps'), ...packages],
      { windowsHide: true, env: { ...process.env, PYTHONNOUSERSITE: '1' } }
    )
    let output = ''
    proc.stdout.on('data', (d) => (output += d))
    proc.stderr.on('data', (d) => (output += d))
    proc.on('error', (e) => done({ ok: false, output: e.message }))
    proc.on('close', (code) => done({ ok: code === 0, output: output.trim().split('\n').slice(-5).join('\n') }))
  })
}

export function cut(text: string, limit = MAX_READ_CHARS): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…[truncated ${text.length - limit} characters]`
}

/** Installed skills: Skills/<id>/SKILL.md, read fresh each time (they are small and few). */
class SkillStore extends EventEmitter<{ changed: [SkillInfo[]] }> {
  list(): SkillInfo[] {
    const dir = skillsDir()
    if (!existsSync(dir)) return []
    const disabled = settings.get('skillsDisabled') ?? {}
    const trusted = settings.get('skillsTrusted') ?? {}
    const skills: SkillInfo[] = []
    for (const id of readdirSync(dir)) {
      const folder = join(dir, id)
      const file = join(folder, 'SKILL.md')
      if (!existsSync(file)) continue
      const { data } = parseFrontMatter(readFileSync(file, 'utf8'))
      const meta = readJson<SkillMeta>(join(folder, SKILL_META), {})
      const files = listFiles(folder)
      skills.push({
        id,
        name: data.name || id,
        description: data.description || '',
        enabled: !disabled[id],
        trusted: !!trusted[id],
        folder,
        source: meta.source,
        installedAt: meta.installedAt,
        requirementsError: meta.requirementsError,
        scripts: files.filter((f) => extname(f).toLowerCase() === '.py'),
        files,
        hasRequirements: existsSync(join(folder, 'requirements.txt'))
      })
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Enabled skills the model is offered. */
  active(): SkillInfo[] {
    return settings.get('skillsEnabled') === false ? [] : this.list().filter((s) => s.enabled)
  }

  /** A skill by folder id or by its front-matter name. */
  find(name: string): SkillInfo | undefined {
    const key = name.trim().toLowerCase()
    return this.active().find((s) => s.id.toLowerCase() === key || s.name.toLowerCase() === key)
  }

  private need(name: string): SkillInfo {
    const skill = this.find(name)
    if (!skill) {
      const names = this.active().map((s) => s.name).join(', ') || 'none'
      throw new Error(`No enabled skill called "${name}". Available: ${names}`)
    }
    return skill
  }

  /** A path inside the skill's folder; anything that escapes it is refused. */
  private inside(skill: SkillInfo, path: string): string {
    const full = resolve(skill.folder, path)
    if (full !== skill.folder && !full.startsWith(skill.folder + sep)) throw new Error(`${path} is outside the skill`)
    return full
  }

  /** SKILL.md without its front matter, plus the list of files the skill ships. */
  load(name: string): string {
    const skill = this.need(name)
    const { body } = parseFrontMatter(readFileSync(join(skill.folder, 'SKILL.md'), 'utf8'))
    const others = skill.files.filter((f) => f !== 'SKILL.md')
    return [
      `# Skill: ${skill.name}`,
      `Skill folder: ${skill.folder}`,
      `Scripts run with ${skillWorkspace()} as the working directory, so relative output paths land there.`,
      '',
      cut(body.trim()),
      others.length ? `\nFiles in this skill:\n${others.map((f) => `- ${f}`).join('\n')}` : ''
    ].join('\n')
  }

  readFile(name: string, path: string): string {
    const skill = this.need(name)
    const full = this.inside(skill, path)
    if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`${skill.name} has no file ${path}`)
    return cut(readFileSync(full, 'utf8'))
  }

  /**
   * Runs one of the skill's Python scripts with the bundled interpreter and
   * returns what it printed. Asks the user first unless they trust the skill.
   */
  async runScript(name: string, script: string, args: string[] = [], stdin?: string, chatId?: string): Promise<string> {
    const skill = this.need(name)
    const full = this.inside(skill, script)
    if (extname(full).toLowerCase() !== '.py' || !existsSync(full)) {
      throw new Error(`${script} is not a Python script in ${skill.name}. Scripts: ${skill.scripts.join(', ') || 'none'}`)
    }
    if (!skill.trusted) {
      const answer = await askApproval(chatId, {
        title: `Run a script from the ${skill.name} skill?`,
        command: `python ${relative(skill.folder, full).split(sep).join('/')} ${args.join(' ')}`.trim(),
        detail: `Runs with Llama Run's Python in ${skillWorkspace()}`,
        alwaysLabel: 'Always allow this skill'
      })
      if (answer === 'deny') throw new Error('The user denied running this script. Ask them what to do instead.')
      if (answer === 'always') this.setTrusted(skill.id, true)
    }
    let result = await this.spawnScript(skill, full, args, stdin)
    // Skills written for Claude expect its sandbox's packages (pypdf, openpyxl…). Offer to add the missing one.
    const missing = missingPackage(result.err)
    if (missing) {
      const answer = await askApproval(chatId, {
        title: `Install ${missing} for the ${skill.name} skill?`,
        command: `pip install ${missing}`,
        detail: `The script needs the Python package ${missing}. It is installed into this skill's own folder (prebuilt wheels only), then the script runs again.`,
        alwaysLabel: 'Install and trust this skill'
      })
      if (answer !== 'deny') {
        if (answer === 'always') this.setTrusted(skill.id, true)
        const installed = await pipInstall(skill.folder, [missing])
        if (!installed.ok) return cut(`${result.text}\n\nInstalling ${missing} failed:\n${installed.output}`, MAX_OUTPUT_CHARS)
        result = await this.spawnScript(skill, full, args, stdin)
      }
    }
    return result.text
  }

  private spawnScript(skill: SkillInfo, full: string, args: string[], stdin?: string): Promise<{ text: string; err: string }> {
    const cwd = skillWorkspace()
    mkdirSync(cwd, { recursive: true })
    const paths = [join(skill.folder, '.deps'), skill.folder, process.env.PYTHONPATH].filter(Boolean)
    return new Promise((done, fail) => {
      const proc = spawn(pythonExecutable(), ['-s', full, ...args.map(String)], {
        cwd,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONPATH: paths.join(delimiter),
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          PYTHONNOUSERSITE: '1',
          LLAMARUN_SKILL_DIR: skill.folder
        }
      })
      let out = ''
      let err = ''
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        proc.kill()
      }, SCRIPT_TIMEOUT_MS)
      proc.stdout.on('data', (d) => (out += d))
      proc.stderr.on('data', (d) => (err += d))
      proc.on('error', (e) => {
        clearTimeout(timer)
        fail(e)
      })
      proc.on('close', (code) => {
        clearTimeout(timer)
        const parts = [`exit code: ${code}`]
        if (out.trim()) parts.push(`stdout:\n${out.trim()}`)
        if (err.trim()) parts.push(`stderr:\n${err.trim()}`)
        if (timedOut) parts.push(`(stopped after ${SCRIPT_TIMEOUT_MS / 60_000} minutes)`)
        done({ text: cut(parts.join('\n\n'), MAX_OUTPUT_CHARS), err })
      })
      proc.stdin.end(stdin ?? '')
    })
  }

  setEnabled(id: string, enabled: boolean): void {
    const disabled = { ...settings.get('skillsDisabled') }
    if (enabled) delete disabled[id]
    else disabled[id] = true
    settings.set({ skillsDisabled: disabled })
    this.changed()
  }

  setTrusted(id: string, trusted: boolean): void {
    const all = { ...settings.get('skillsTrusted') }
    if (trusted) all[id] = true
    else delete all[id]
    settings.set({ skillsTrusted: all })
    this.changed()
  }

  remove(id: string): void {
    const folder = resolve(skillsDir(), id)
    if (!folder.startsWith(resolve(skillsDir()) + sep)) throw new Error('Not a skill folder')
    rmSync(folder, { recursive: true, force: true })
    this.setTrusted(id, false)
  }

  changed(): void {
    this.emit('changed', this.list())
  }
}

export const skillStore = new SkillStore()

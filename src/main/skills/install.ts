import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { x as extractTar } from 'tar'
import type { SkillInfo } from '@shared/types'
import { writeJson } from '../jsonFile'
import { pythonExecutable } from '../paths'
import { installRequirements } from '../plugins/install'
import { parseFrontMatter } from './frontMatter'
import { describeSource, resolveSource, type SkillSource } from './source'
import { SKILL_META, skillsDir, skillStore, type SkillMeta } from './store'

const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024
const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv'])

function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((done, fail) => {
    const proc = spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (out += d))
    proc.on('error', fail)
    proc.on('close', (code) => (code === 0 ? done(out) : fail(new Error(out.trim() || `${cmd} exited with ${code}`))))
  })
}

async function download(url: string, file: string, headers: Record<string, string> = {}): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': 'LlamaRun', ...headers }, redirect: 'follow' })
  if (res.status === 404) throw new Error(`Not found: ${url}. Is it public?`)
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}) for ${url}`)
  if (Number(res.headers.get('content-length') ?? 0) > MAX_DOWNLOAD_BYTES) throw new Error('That download is too large')
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('That download is too large')
  writeFileSync(file, bytes)
}

/** Unzips with the bundled Python, as plugin installs do. */
const unzip = (zip: string, out: string): Promise<string> => run(pythonExecutable(), ['-s', '-m', 'zipfile', '-e', zip, out])

/** Folders under `root` that hold a SKILL.md (a skill's own subfolders are not searched). */
export function findSkillFolders(root: string, depth = 0): string[] {
  if (existsSync(join(root, 'SKILL.md'))) return [root]
  if (depth > 6) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP.has(e.name))
    .flatMap((e) => findSkillFolders(join(root, e.name), depth + 1))
}

export function skillIdFor(folder: string): string {
  const { data } = parseFrontMatter(readFileSync(join(folder, 'SKILL.md'), 'utf8'))
  const name = (data.name || basename(folder)).toLowerCase()
  return name.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill'
}

/** Puts the source's files in `out` and returns the folder to search for skills. */
async function fetchSource(source: SkillSource, tmp: string): Promise<string> {
  const out = join(tmp, 'src')
  mkdirSync(out, { recursive: true })
  switch (source.kind) {
    case 'folder':
      return resolve(source.path)
    case 'zip-file':
      await unzip(source.path, out)
      return out
    case 'zip-url': {
      const zip = join(tmp, 'skill.zip')
      await download(source.url, zip)
      await unzip(zip, out)
      return out
    }
    case 'skill-md': {
      const res = await fetch(source.url, { headers: { 'User-Agent': 'LlamaRun' } })
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}) for ${source.url}`)
      const dir = join(out, 'skill')
      mkdirSync(dir)
      writeFileSync(join(dir, 'SKILL.md'), await res.text())
      return out
    }
    case 'github': {
      const archive = join(tmp, 'repo.tar.gz')
      const ref = source.ref ? `/${encodeURIComponent(source.ref)}` : ''
      await download(`https://api.github.com/repos/${source.owner}/${source.repo}/tarball${ref}`, archive, {
        Accept: 'application/vnd.github+json'
      })
      await extractTar({ file: archive, cwd: out, strip: 1 })
      return join(out, source.path)
    }
    case 'git': {
      try {
        await run('git', ['clone', '--depth', '1', ...(source.ref ? ['--branch', source.ref] : []), source.url, out])
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error('Installing from this site needs Git. Install Git for Windows, or use “Install with AI”.')
        }
        throw err
      }
      return join(out, source.path)
    }
  }
}

/**
 * Installs every skill found at `input` (a link, a .zip or a folder) into
 * Skills/<name>, replacing older copies. A skill's requirements.txt is
 * installed (prebuilt wheels only) into its .deps folder.
 */
export async function installSkills(input: string): Promise<SkillInfo[]> {
  const source = resolveSource(input, {
    isDir: (p) => existsSync(p) && statSync(p).isDirectory(),
    isFile: (p) => existsSync(p) && statSync(p).isFile()
  })
  const tmp = mkdtempSync(join(tmpdir(), 'llamarun-skill-'))
  try {
    const base = resolve(await fetchSource(source, tmp))
    if (!existsSync(base)) throw new Error('That folder is not in the download')
    const found = findSkillFolders(base)
    if (!found.length) {
      throw new Error('No SKILL.md found there. If its README explains how to set it up, use “Install with AI”.')
    }
    const installed: string[] = []
    mkdirSync(skillsDir(), { recursive: true })
    for (const folder of found) {
      const id = skillIdFor(folder)
      const dest = resolve(skillsDir(), id)
      if (!dest.startsWith(resolve(skillsDir()) + sep)) continue
      rmSync(dest, { recursive: true, force: true })
      cpSync(folder, dest, { recursive: true, filter: (p) => !SKIP.has(basename(p)) })
      const meta: SkillMeta = { source: describeSource(source), installedAt: Date.now() }
      try {
        await installRequirements(dest)
      } catch (err) {
        meta.requirementsError = (err as Error).message
      }
      writeJson(join(dest, SKILL_META), meta)
      installed.push(id)
    }
    skillStore.changed()
    return skillStore.list().filter((s) => installed.includes(s.id))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

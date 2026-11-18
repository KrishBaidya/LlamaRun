import { createReadStream, readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

/**
 * Finding files without a shell, like OpenCode's glob/grep/list and Hermes'
 * search_files: read-only, so a search costs no command approval. Results are
 * capped and paged so a big folder never floods the context.
 */

/** Folders nobody means when they search a project: skipped unless the pattern names them. */
const SKIPPED = new Set(['node_modules', '.git', '.hg', '.svn', '__pycache__', '.venv', 'venv', '.next', 'dist', 'out', 'build', '.cache'])
/** Files grep doesn't open: binaries and anything this large is not text worth matching. */
const MAX_GREP_BYTES = 5 * 1024 * 1024
const BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|7z|gz|tar|rar|exe|dll|so|dylib|bin|woff2?|ttf|otf|mp[34]|mov|avi|wav|flac|docx?|xlsx?|pptx?|db|sqlite|pyc|class|jar|node)$/i
/** Most entries walked in one search, so a search of C:\ ends instead of running for minutes. */
const MAX_WALK = 200_000

export interface Page {
  lines: string[]
  /** Matches found in all, when the walk finished. */
  total: number
  /** The walk stopped early (MAX_WALK or the time limit). */
  partial: boolean
}

/** A glob as a regular expression over /-separated relative paths: **, *, ?, [abc] and {a,b}. */
export function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '')
  let re = ''
  let braces = 0
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        // "**/" matches any number of folders, including none; a bare "**" anything.
        const slash = g[i + 2] === '/'
        re += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '[') {
      const end = g.indexOf(']', i + 1)
      if (end < 0) re += '\\['
      else {
        re += `[${g.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
        i = end
      }
    } else if (c === '{') {
      braces++
      re += '(?:'
    } else if (c === '}' && braces) {
      braces--
      re += ')'
    } else if (c === ',' && braces) re += '|'
    else re += /[.+^$()|\\]/.test(c) ? `\\${c}` : c
  }
  return new RegExp(`^${re}$`, process.platform === 'win32' ? 'i' : '')
}

/**
 * Every file under root (relative, /-separated), skipping SKIPPED folders unless
 * `include` mentions them. Newest-first ordering is left to callers.
 */
function* walk(root: string, include = '', deadline = Date.now() + 20_000): Generator<{ rel: string; full: string; dirent: Dirent }, boolean> {
  const stack = ['']
  let seen = 0
  while (stack.length) {
    const dir = stack.pop()!
    let entries: Dirent[]
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const dirent of entries) {
      if (++seen > MAX_WALK || Date.now() > deadline) return false
      const rel = dir ? `${dir}/${dirent.name}` : dirent.name
      if (dirent.isDirectory()) {
        if (SKIPPED.has(dirent.name) && !include.includes(dirent.name)) continue
        stack.push(rel)
      }
      yield { rel, full: join(root, rel), dirent }
    }
  }
  return true
}

/** Paths under root matching the glob, newest first, one page of them. */
export function globFiles(root: string, pattern: string, offset = 0, limit = 200): Page {
  const re = globToRegExp(pattern.includes('/') || pattern.startsWith('**') ? pattern : `**/${pattern}`)
  const found: { rel: string; time: number }[] = []
  const it = walk(root, pattern)
  let step = it.next()
  while (!step.done) {
    const { rel, full, dirent } = step.value
    if (dirent.isFile() && re.test(rel)) {
      let time = 0
      try {
        time = statSync(full).mtimeMs
      } catch {
        /* gone since the listing */
      }
      found.push({ rel, time })
    }
    step = it.next()
  }
  found.sort((a, b) => b.time - a.time || a.rel.localeCompare(b.rel))
  return { lines: found.slice(offset, offset + limit).map((f) => f.rel), total: found.length, partial: step.value === false }
}

/** One folder's entries: folders first (with a /), then files with their size. */
export function listDir(dir: string, offset = 0, limit = 200): Page {
  const entries = readdirSync(dir, { withFileTypes: true })
  const rows = entries
    .map((e) => {
      const folder = e.isDirectory()
      let size = ''
      if (!folder) {
        try {
          size = ` (${formatSize(statSync(join(dir, e.name)).size)})`
        } catch {
          /* unreadable */
        }
      }
      return { folder, line: folder ? `${e.name}/` : `${e.name}${size}` }
    })
    .sort((a, b) => Number(b.folder) - Number(a.folder) || a.line.localeCompare(b.line))
    .map((r) => r.line)
  return { lines: rows.slice(offset, offset + limit), total: rows.length, partial: false }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export interface GrepOptions {
  /** Only files whose relative path matches this glob, e.g. "*.ts" or "src/**". */
  include?: string
  ignoreCase?: boolean
  /** Lines of context either side of a match. */
  context?: number
  offset?: number
  limit?: number
}

/** Lines matching a regular expression in the files under root ("path:line: text"), one page of them. */
export async function grepFiles(root: string, pattern: string, options: GrepOptions = {}): Promise<Page> {
  let re: RegExp
  try {
    re = new RegExp(pattern, options.ignoreCase ? 'i' : '')
  } catch (err) {
    throw new Error(`Not a valid regular expression: ${(err as Error).message}`)
  }
  const only = options.include ? globToRegExp(options.include.includes('/') || options.include.startsWith('**') ? options.include : `**/${options.include}`) : null
  const offset = options.offset ?? 0
  const limit = options.limit ?? 100
  const context = Math.max(0, Math.min(5, options.context ?? 0))
  const lines: string[] = []
  let total = 0
  const it = walk(root, options.include ?? '')
  let step = it.next()
  while (!step.done) {
    const { rel, full, dirent } = step.value
    step = it.next()
    if (!dirent.isFile() || BINARY.test(rel) || (only && !only.test(rel))) continue
    try {
      if (statSync(full).size > MAX_GREP_BYTES) continue
    } catch {
      continue
    }
    const before: string[] = []
    let after = 0
    let n = 0
    const reader = createInterface({ input: createReadStream(full, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const raw of reader) {
      n++
      const line = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw
      if (line.includes('\u0000')) break
      if (re.test(raw)) {
        total++
        if (total > offset && lines.length < limit) {
          lines.push(...before.map((b, i) => `${rel}-${n - before.length + i}- ${b}`), `${rel}:${n}: ${line}`)
          after = context
        }
        before.length = 0
      } else {
        if (after > 0 && lines.length < limit + context) {
          lines.push(`${rel}-${n}- ${line}`)
          after--
        }
        if (context) {
          before.push(line)
          if (before.length > context) before.shift()
        }
      }
    }
  }
  return { lines, total, partial: step.value === false }
}

/** A page as tool output, saying where to read on. */
export function formatPage(title: string, page: Page, offset: number, empty: string): string {
  if (!page.total) return page.partial ? `${empty} (the search stopped early; narrow it down)` : empty
  const shown = page.lines.length
  const end = Math.min(page.total, offset + shown)
  const more = end < page.total ? `\n…more: ${page.total - end} not shown, read on with offset ${end}.` : ''
  const partial = page.partial ? '\n(the search stopped early in a very large folder; results may be incomplete)' : ''
  return `${title} (${offset + 1}-${end} of ${page.total})\n${page.lines.join('\n')}${more}${partial}`
}


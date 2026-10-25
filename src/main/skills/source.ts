/** Where a skill comes from, worked out from what the user pasted, dropped or picked. */
export type SkillSource =
  | { kind: 'folder'; path: string }
  | { kind: 'zip-file'; path: string }
  | { kind: 'github'; owner: string; repo: string; ref?: string; path: string }
  /** GitLab, Bitbucket or any other git host: cloned with git. */
  | { kind: 'git'; url: string; ref?: string; path: string }
  | { kind: 'zip-url'; url: string }
  /** A skill that is just one SKILL.md file. */
  | { kind: 'skill-md'; url: string }

const GIT_HOSTS = new Set(['gitlab.com', 'bitbucket.org', 'codeberg.org'])

/**
 * Understands, like Claude's own installers:
 * - a local folder or a .zip / .skill file (`isDir` / `isFile` say what exists on disk)
 * - GitHub: owner/repo, github.com/o/r, …/tree/<ref>/<path>, …/blob/<ref>/<path>/SKILL.md
 * - GitLab, Bitbucket, Codeberg pages (…/-/tree/<ref>/<path>, …/src/<ref>/<path>) and any *.git URL
 * - a direct link to a .zip, or to a raw SKILL.md
 */
export function resolveSource(
  input: string,
  fs: { isDir: (p: string) => boolean; isFile: (p: string) => boolean } = { isDir: () => false, isFile: () => false }
): SkillSource {
  const raw = input.trim().replace(/^["']|["']$/g, '')
  if (!raw) throw new Error('Paste a link, or choose a ZIP or folder')
  if (fs.isDir(raw)) return { kind: 'folder', path: raw }
  if (fs.isFile(raw)) {
    if (/\.(zip|skill)$/i.test(raw)) return { kind: 'zip-file', path: raw }
    throw new Error('Choose a .zip or .skill file, or a folder')
  }

  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(raw)
  if (short) return { kind: 'github', owner: short[1], repo: short[2].replace(/\.git$/, ''), path: '' }

  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw new Error('That is not a link, file or folder Llama Run can install from')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Use an https:// link')
  const host = url.hostname.replace(/^www\./, '')
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

  if (host === 'raw.githubusercontent.com' || /\/SKILL\.md$/i.test(url.pathname)) {
    if (host === 'github.com' && parts[2] === 'blob') {
      // github.com/o/r/blob/<ref>/<dir>/SKILL.md: install the folder, with its scripts.
      return { kind: 'github', owner: parts[0], repo: parts[1], ref: parts[3], path: parts.slice(4, -1).join('/') }
    }
    if (/\/SKILL\.md$/i.test(url.pathname)) return { kind: 'skill-md', url: url.href }
  }
  if (/\.zip$/i.test(url.pathname)) return { kind: 'zip-url', url: url.href }

  if (host === 'github.com') {
    const [owner, repo, kind, ref, ...rest] = parts
    if (!owner || !repo) throw new Error('That GitHub link is missing the repository name')
    const name = repo.replace(/\.git$/, '')
    // A blob link points at a file: install from the folder it is in.
    if (kind === 'tree') return { kind: 'github', owner, repo: name, ref, path: rest.join('/') }
    if (kind === 'blob') return { kind: 'github', owner, repo: name, ref, path: rest.slice(0, -1).join('/') }
    return { kind: 'github', owner, repo: name, path: '' }
  }

  if (GIT_HOSTS.has(host) || /\.git$/i.test(url.pathname)) {
    // GitLab: /group/project/-/tree/<ref>/<path>; Bitbucket and Codeberg: /owner/repo/src/<ref>/<path>.
    const dash = parts.indexOf('-')
    let repoParts = parts
    let ref: string | undefined
    let path = ''
    if (dash > 0 && (parts[dash + 1] === 'tree' || parts[dash + 1] === 'blob')) {
      repoParts = parts.slice(0, dash)
      ref = parts[dash + 2]
      path = parts.slice(dash + 3).join('/')
    } else if (parts.length > 3 && (parts[2] === 'src' || parts[2] === 'tree')) {
      repoParts = parts.slice(0, 2)
      ref = parts[3]
      path = parts.slice(4).join('/')
    }
    const repoPath = repoParts.join('/').replace(/\.git$/, '')
    return { kind: 'git', url: `${url.protocol}//${url.host}/${repoPath}.git`, ref, path }
  }

  throw new Error('Llama Run can install from GitHub, GitLab, Bitbucket, any .git link, a .zip link or a SKILL.md link. Try “Install with AI” for anything else.')
}

/** Where to read a source's README from, for "Install with AI". */
export function describeSource(source: SkillSource): string {
  switch (source.kind) {
    case 'github':
      return `https://github.com/${source.owner}/${source.repo}${source.path ? `/tree/${source.ref ?? 'HEAD'}/${source.path}` : ''}`
    case 'git':
      return source.url
    case 'folder':
    case 'zip-file':
      return source.path
    default:
      return source.url
  }
}

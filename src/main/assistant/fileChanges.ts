import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { readJson, writeJson } from '../jsonFile'
import { userDataPath } from '../paths'
import { skillWorkspace } from '../skills/store'

/**
 * Undo for the files a reply changed, like OpenCode's snapshots and Hermes'
 * /undo. Before write_file, edit_file or render_html changes one of the user's
 * files, the original is copied aside once per reply; undo puts them back and
 * removes files the reply created. The skill workspace is the model's own
 * scratch folder and isn't tracked. Changes made by run_command or run_code
 * scripts can't be seen here, so they aren't covered.
 */

interface Change {
  path: string
  /** File name of the original's copy; none when the reply created the file. */
  backup?: string
}

const folderFor = (chatId: string, messageId: string): string => userDataPath('Backups', chatId, messageId)
const manifestFor = (chatId: string, messageId: string): string => join(folderFor(chatId, messageId), 'changes.json')
const same = (a: string, b: string): boolean => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b))
const inside = (path: string, folder: string): boolean => {
  const rel = relative(folder, path)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/** Call right before writing `path` for a reply: keeps the original the first time the reply touches it. */
export function recordChange(chatId: string | undefined, messageId: string | undefined, path: string): void {
  if (!chatId || !messageId || inside(path, skillWorkspace())) return
  const manifest = manifestFor(chatId, messageId)
  const changes = readJson<Change[]>(manifest, [])
  if (changes.some((c) => same(c.path, path))) return
  mkdirSync(folderFor(chatId, messageId), { recursive: true })
  if (existsSync(path)) {
    const backup = `${changes.length}.bak`
    copyFileSync(path, join(folderFor(chatId, messageId), backup))
    changes.push({ path, backup })
  } else {
    changes.push({ path })
  }
  writeJson(manifest, changes)
}

/** The user's files a reply changed or created. */
export function changedFiles(chatId: string, messageId: string): string[] {
  return readJson<Change[]>(manifestFor(chatId, messageId), []).map((c) => c.path)
}

/** Puts back what a reply changed and removes what it created; returns the files handled. */
export function undoChanges(chatId: string, messageId: string): string[] {
  const changes = readJson<Change[]>(manifestFor(chatId, messageId), [])
  for (const c of changes) {
    if (c.backup) copyFileSync(join(folderFor(chatId, messageId), c.backup), c.path)
    else rmSync(c.path, { force: true })
  }
  rmSync(folderFor(chatId, messageId), { recursive: true, force: true })
  return changes.map((c) => c.path)
}

/** A deleted chat's backups go with it. */
export function forgetChanges(chatId: string): void {
  rmSync(userDataPath('Backups', chatId), { recursive: true, force: true })
}

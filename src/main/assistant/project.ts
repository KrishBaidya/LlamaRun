import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

/**
 * Project folders, like Claude Code's CLAUDE.md, Codex's and OpenCode's
 * AGENTS.md, Gemini CLI's GEMINI.md, and Claude's and ChatGPT's Projects: a
 * chat can work in a folder, which becomes where its commands and relative
 * paths start and which its file tools may use without asking, and the
 * folder's instruction file joins its prompt.
 */

/** Instruction files a project folder may have, in the order they're looked for. */
export const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md']
/** Most characters of instructions the prompt carries. */
const MAX_INSTRUCTIONS = 20_000

/** The project's instructions for the prompt: its first instruction file found, under a heading. */
export function projectInstructions(folder: string | undefined): string {
  if (!folder || !existsSync(folder)) return ''
  for (const name of INSTRUCTION_FILES) {
    const file = join(folder, name)
    try {
      if (!existsSync(file) || !statSync(file).isFile()) continue
      let text = readFileSync(file, 'utf8').trim()
      if (!text) continue
      if (text.length > MAX_INSTRUCTIONS) text = `${text.slice(0, MAX_INSTRUCTIONS)}\n…(cut)`
      return `## Project: ${basename(folder)}\nThis chat works in ${folder}: commands start there and relative paths are inside it. Its ${name} says:\n\n${text}`
    } catch {
      /* unreadable: look for the next */
    }
  }
  return `## Project: ${basename(folder)}\nThis chat works in ${folder}: commands start there and relative paths are inside it.`
}

export function validProject(folder: unknown): string | undefined {
  if (typeof folder !== 'string' || !folder.trim()) return undefined
  try {
    return statSync(folder).isDirectory() ? folder : undefined
  } catch {
    return undefined
  }
}

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { userDataPath } from '../paths'
import { settings } from '../settings'

/**
 * Commands in a sandbox, like Codex's workspace-write mode and Claude Code's
 * bash sandbox, built on Windows' integrity levels with no native code:
 * Windows starts a program at low integrity when its file is labelled low, and
 * everything it starts inherits that. So commands run through a low-labelled
 * copy of cmd.exe, and a low-integrity process can write only where the label
 * is low too: the skills workspace, the chat's project folder (labelled when
 * the sandbox first uses it) and the sandbox's own temp folder. It can still
 * read files and use the network; it can't change the rest of the user's files,
 * the registry outside its own corner, or processes at the normal level.
 * (Spike: a copy of cmd.exe labelled with `icacls /setintegritylevel low`
 * starts PowerShell at low integrity; writes outside low-labelled folders are
 * "Access denied"; bundled Python, TEMP and the network work.)
 */

export const sandboxOn = (): boolean => process.platform === 'win32' && settings.get('commandSandbox') === true

const dir = (): string => userDataPath('sandbox')
const launcher = (): string => join(dir(), 'cmd-low.exe')
export const sandboxTemp = (): string => join(dir(), 'tmp')

/** Folders labelled low this run, so each is labelled once. */
const labelled = new Set<string>()

export type Labeller = (path: string, inherit: boolean) => void
const defaultLabeller: Labeller = (path, inherit) => {
  execFileSync('icacls', [path, '/setintegritylevel', inherit ? '(OI)(CI)low' : 'low'], { windowsHide: true, stdio: 'ignore' })
}
let label: Labeller = defaultLabeller
/** Tests swap the labelling. */
export function setLabeller(next: Labeller | null): void {
  label = next ?? defaultLabeller
}

/** The low-integrity launcher and temp folder, made on first use. */
export function prepareSandbox(): string {
  mkdirSync(sandboxTemp(), { recursive: true })
  if (!existsSync(launcher())) {
    copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'), launcher())
  }
  if (!labelled.has(launcher())) {
    label(launcher(), false)
    labelled.add(launcher())
  }
  allowWrites(sandboxTemp())
  return launcher()
}

/** Lets sandboxed commands write in a folder (and everything inside it) from now on. */
export function allowWrites(folder: string): void {
  if (labelled.has(folder)) return
  label(folder, true)
  labelled.add(folder)
}

/** PowerShell's -EncodedCommand: the command as base64 UTF-16LE, so nothing in it needs escaping through cmd. */
export const encodeCommand = (command: string): string => Buffer.from(command, 'utf16le').toString('base64')

/**
 * Starts a PowerShell command at low integrity. `writable` are the folders it
 * may change (the workspace and the project); its TEMP is the sandbox's own.
 */
export function spawnSandboxed(command: string, cwd: string, env: NodeJS.ProcessEnv, writable: string[]): ChildProcess {
  const exe = prepareSandbox()
  for (const folder of writable) if (existsSync(folder)) allowWrites(folder)
  const temp = sandboxTemp()
  const args = ['/d', '/s', '/c', `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodeCommand(command)}`]
  return spawn(exe, args, { cwd, windowsHide: true, windowsVerbatimArguments: true, env: { ...env, TEMP: temp, TMP: temp, LLAMARUN_SANDBOX: '1' } })
}

/** A line for approval cards and results: what the sandbox lets this command change. */
export const sandboxNote = (writable: string[]): string => `Sandboxed: it can change files only in ${writable.join(' and ')}.`

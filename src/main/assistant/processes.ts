import { spawn, type ChildProcess } from 'node:child_process'
import { spawnSandboxed } from './sandbox'

/**
 * Commands left running in the background (a dev server, a long download, a
 * watcher), like Claude Code's run_in_background and Hermes' process registry.
 * Each belongs to a chat; the model reads what is new in their output and can
 * stop them. They are stopped with their chat, and all of them when the app quits.
 */

/** Output kept per process: the latest this many characters. */
const KEEP = 100_000
/** Most background processes one chat keeps at once. */
export const MAX_PER_CHAT = 8

export interface BackgroundProcess {
  id: string
  chatId: string
  command: string
  cwd: string
  started: number
  /** null while running. */
  exitCode: number | null
  /** Set when it ended by process_stop or cleanup. */
  stopped: boolean
  /** All output ever written, counted in characters, so readers can ask for what is new. */
  written: number
  /** The kept output: what was written from written - log.length on. */
  log: string
  /** How far the model has read. */
  read: number
  child: ChildProcess
}

const byChat = new Map<string, Map<string, BackgroundProcess>>()
let counter = 0

export type Spawner = (command: string, cwd: string, env: NodeJS.ProcessEnv) => ChildProcess

const defaultSpawner: Spawner = (command, cwd, env) =>
  process.platform === 'win32'
    ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { cwd, env, windowsHide: true })
    : spawn('/bin/sh', ['-c', command], { cwd, env, detached: true })

let spawner: Spawner = defaultSpawner
/** Tests swap the spawner. */
export function setSpawner(next: Spawner | null): void {
  spawner = next ?? defaultSpawner
}

function append(p: BackgroundProcess, chunk: string): void {
  p.written += chunk.length
  p.log = (p.log + chunk).slice(-KEEP)
}

export function startBackground(chatId: string, command: string, cwd: string, env: NodeJS.ProcessEnv, writable?: string[]): BackgroundProcess {
  const mine = byChat.get(chatId) ?? new Map<string, BackgroundProcess>()
  const running = [...mine.values()].filter((p) => p.exitCode === null && !p.stopped)
  if (running.length >= MAX_PER_CHAT) throw new Error(`This chat already has ${MAX_PER_CHAT} background commands running. Stop one with process_stop first.`)
  const child = writable && spawner === defaultSpawner ? spawnSandboxed(command, cwd, env, writable) : spawner(command, cwd, env)
  const p: BackgroundProcess = { id: `bg${++counter}`, chatId, command, cwd, started: Date.now(), exitCode: null, stopped: false, written: 0, log: '', read: 0, child }
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (d: string) => append(p, d))
  child.stderr?.on('data', (d: string) => append(p, d))
  child.on('error', (e) => {
    append(p, `\n${e.message}\n`)
    if (p.exitCode === null) p.exitCode = -1
  })
  child.on('close', (code) => {
    if (p.exitCode === null) p.exitCode = code ?? -1
  })
  child.stdin?.end()
  mine.set(p.id, p)
  byChat.set(chatId, mine)
  return p
}

function find(chatId: string | undefined, id: string): BackgroundProcess {
  const p = chatId ? byChat.get(chatId)?.get(id) : undefined
  if (!p) throw new Error(`No background command ${id} in this chat. ${list(chatId)}`)
  return p
}

const status = (p: BackgroundProcess): string =>
  p.exitCode === null ? `running for ${Math.round((Date.now() - p.started) / 1000)}s` : p.stopped ? 'stopped' : `exited with code ${p.exitCode}`

/** This chat's background commands, one line each. */
export function list(chatId: string | undefined): string {
  const mine = chatId ? [...(byChat.get(chatId)?.values() ?? [])] : []
  if (!mine.length) return 'No background commands in this chat.'
  return `Background commands:\n${mine.map((p) => `- ${p.id}: ${p.command} (${status(p)})`).join('\n')}`
}

/**
 * What a background command wrote since it was last read (or everything kept,
 * with all), and whether it is still running.
 */
export function output(chatId: string | undefined, id: string, all = false): string {
  const p = find(chatId, id)
  const from = all ? 0 : p.read
  p.read = p.written
  const dropped = p.written - p.log.length
  const text = from >= dropped ? p.log.slice(from - dropped) : `…(${dropped - from} earlier characters not kept)…\n${p.log}`
  return `${p.id} (${p.command}) is ${status(p)}.\n${text.trim() ? text.trimEnd() : '(no new output)'}`
}

/** Ends a process and everything it started (taskkill /T on Windows: PowerShell's children too). */
function kill(p: BackgroundProcess): void {
  if (p.exitCode !== null) return
  p.stopped = true
  const pid = p.child.pid
  try {
    if (process.platform === 'win32' && pid) spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => p.child.kill())
    else if (pid) process.kill(-pid, 'SIGTERM')
    else p.child.kill()
  } catch {
    p.child.kill()
  }
}

export function stop(chatId: string | undefined, id: string): string {
  const p = find(chatId, id)
  if (p.exitCode !== null) return `${p.id} had already ${status(p)}.`
  kill(p)
  return `Stopped ${p.id} (${p.command}).`
}

/** A deleted chat's commands go with it. */
export function stopChat(chatId: string): void {
  for (const p of byChat.get(chatId)?.values() ?? []) kill(p)
  byChat.delete(chatId)
}

/** On quit: nothing keeps running after Llama Run. */
export function stopAll(): void {
  for (const chatId of [...byChat.keys()]) stopChat(chatId)
}

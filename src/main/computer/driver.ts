import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { userDataPath } from '../paths'
import type { AuthorizationAsk, DriverResult, WorkerRequest, WorkerResponse } from './protocol'

/** Longest a single driver call may take before it's reported as failed. */
const CALL_TIMEOUT_MS = 60_000
/** browser_prepare waits for the user to answer the approval card (the driver's own request expiry bounds it too). */
const PREPARE_TIMEOUT_MS = 5 * 60_000

/**
 * The only Cua Driver tools Llama Run calls. The runtime refuses every other
 * one (killing processes, desktop capture, downloads, recordings, scripts,
 * configuration), whatever reaches it. Attaching to the user's signed-in
 * browser also needs their answer in an approval card (see setDriverAuthorizer).
 */
export const DRIVER_TOOLS = [
  'start_session',
  'end_session',
  'get_session',
  'get_screen_size',
  'list_apps',
  'list_windows',
  'launch_app',
  'get_window_state',
  'run_steps',
  'click',
  'double_click',
  'right_click',
  'type_text',
  'press_key',
  'hotkey',
  'scroll',
  'drag',
  'set_value',
  'invoke_menu',
  'set_window_frame',
  'clipboard_read',
  'clipboard_write',
  'get_browser_state',
  'browser_prepare',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_select',
  'browser_pointer',
  'browser_dialog',
  'browser_set_input_files'
]

/** Decides what the driver asks its host: true allows that one request. */
export type DriverAuthorizer = (ask: AuthorizationAsk, signal: AbortSignal) => Promise<boolean>

let authorizer: DriverAuthorizer | null = null

/** Who answers the driver's authorization requests (computer/tools.ts shows them as approval cards). */
export function setDriverAuthorizer(next: DriverAuthorizer | null): void {
  authorizer = next
}

/** An authorization request from the driver, answered by the authorizer; with none set, refused. */
export async function askAuthorizer(ask: AuthorizationAsk, signal: AbortSignal): Promise<boolean> {
  if (!authorizer || signal.aborted) return false
  return authorizer(ask, signal).catch(() => false)
}

/** A Cua policy (deny by default) allowing exactly DRIVER_TOOLS. */
export function driverPolicy(): string {
  return `# Written by Llama Run on every start; edits are overwritten.\nallow:\n  tools:\n${DRIVER_TOOLS.map((t) => `    - ${t}`).join('\n')}\n`
}

/** Somewhere Cua Driver tools can be called: the utility-process worker, or the SDK directly (tests). */
export interface DriverTransport {
  call(tool: string, args: Record<string, unknown>): Promise<DriverResult>
  close(): Promise<void>
  /** Stops whatever the driver is doing now (the user pressed Stop): calls in flight fail, the next one starts afresh. */
  restart?(): Promise<void>
}

/**
 * Runs computer/worker.ts in an Electron utility process. One worker lives
 * for the app's lifetime so the driver's element cache and browser
 * connections stay warm; it's started again on the next call if it exits.
 */
class WorkerTransport implements DriverTransport {
  private child: UtilityProcess | null = null
  private started: Promise<UtilityProcess> | null = null
  private seq = 0
  private pending = new Map<number, { resolve: (r: DriverResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  /** Approval questions from the driver that the user hasn't answered yet. */
  private asks = new Map<number, AbortController>()

  private start(): Promise<UtilityProcess> {
    this.started ??= new Promise((resolve, reject) => {
      const policy = userDataPath('cua-driver-policy.yaml')
      writeFileSync(policy, driverPolicy())
      // stdout is ignored (an unread pipe would block a chatty worker); stderr's tail explains a crash.
      const child = utilityProcess.fork(join(__dirname, 'computerWorker.js'), [], {
        serviceName: 'Llama Run Computer Use',
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, CUA_DRIVER_POLICY_FILE: policy }
      })
      let stderr = ''
      child.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)))
      child.on('message', (message: WorkerResponse) => {
        if ('authorize' in message) {
          const { id } = message.authorize
          const abort = new AbortController()
          this.asks.set(id, abort)
          void askAuthorizer(message.authorize, abort.signal).then((allow) => {
            this.asks.delete(id)
            if (this.child === child && !abort.signal.aborted) child.postMessage({ authorized: id, allow } satisfies WorkerRequest)
          })
        } else if ('withdraw' in message) {
          this.asks.get(message.withdraw)?.abort()
          this.asks.delete(message.withdraw)
        } else if ('ready' in message) {
          this.child = child
          resolve(child)
        } else if ('fatal' in message) {
          reject(new Error(`Cua Driver could not start: ${message.fatal}`))
        } else {
          const entry = this.pending.get(message.id)
          if (!entry) return
          this.pending.delete(message.id)
          clearTimeout(entry.timer)
          if ('error' in message) entry.reject(new Error(message.error))
          else entry.resolve(message.result)
        }
      })
      child.on('exit', (code) => {
        const reason = new Error(`The computer-use worker stopped (exit code ${code})${stderr.trim() ? `: ${stderr.trim().split('\n').pop()}` : ''}`)
        if (this.child !== child) reject(reason)
        this.child = null
        this.started = null
        for (const ask of this.asks.values()) ask.abort()
        this.asks.clear()
        for (const [id, entry] of this.pending) {
          clearTimeout(entry.timer)
          entry.reject(reason)
          this.pending.delete(id)
        }
      })
    })
    return this.started
  }

  async call(tool: string, args: Record<string, unknown>): Promise<DriverResult> {
    const child = await this.start()
    const id = ++this.seq
    const limit = tool === 'browser_prepare' ? PREPARE_TIMEOUT_MS : CALL_TIMEOUT_MS
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        // The action may still have reached the app: retrying blind could do it twice.
        reject(new Error(`${tool} took longer than ${limit / 1000} seconds. It may still have happened: look at the window before trying again.`))
      }, limit)
      this.pending.set(id, { resolve, reject, timer })
      child.postMessage({ id, tool, args } satisfies WorkerRequest)
    })
  }

  async close(): Promise<void> {
    const child = this.child
    if (!child) return
    const exited = new Promise<void>((done) => child.once('exit', () => done()))
    child.postMessage({ id: ++this.seq, shutdown: true } satisfies WorkerRequest)
    // Don't hold up quitting on a driver that won't stop.
    await Promise.race([exited, new Promise((done) => setTimeout(done, 3000))])
    if (this.child === child) child.kill()
  }

  /** Kills the worker at once: a running batch stops mid-way instead of finishing its steps. */
  async restart(): Promise<void> {
    const child = this.child
    if (!child) return
    const exited = new Promise<void>((done) => child.once('exit', () => done()))
    child.kill()
    await Promise.race([exited, new Promise((done) => setTimeout(done, 2000))])
  }
}

let transport: DriverTransport | null = null

/** The shared driver connection; created on first use. */
export function driver(): DriverTransport {
  transport ??= new WorkerTransport()
  return transport
}

/** For tests: use another transport (e.g. the SDK in-process, or a fake). */
export function setDriverTransport(next: DriverTransport | null): void {
  transport = next
}

/** Starts the worker ahead of the first action, so the first click isn't slowed by start-up. */
export function warmDriver(): void {
  driver()
    .call('get_screen_size', {})
    .catch((err) => console.warn(`Computer use unavailable: ${(err as Error).message}`))
}

export async function closeDriver(): Promise<void> {
  await transport?.close()
}

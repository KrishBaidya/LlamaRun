import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { DriverResult, WorkerRequest, WorkerResponse } from './protocol'

/** Longest a single driver call may take before it's reported as failed. */
const CALL_TIMEOUT_MS = 60_000

/** Somewhere Cua Driver tools can be called: the utility-process worker, or the SDK directly (tests). */
export interface DriverTransport {
  call(tool: string, args: Record<string, unknown>): Promise<DriverResult>
  close(): Promise<void>
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

  private start(): Promise<UtilityProcess> {
    this.started ??= new Promise((resolve, reject) => {
      // stdout is ignored (an unread pipe would block a chatty worker); stderr's tail explains a crash.
      const child = utilityProcess.fork(join(__dirname, 'computerWorker.js'), [], {
        serviceName: 'Llama Run Computer Use',
        stdio: ['ignore', 'ignore', 'pipe']
      })
      let stderr = ''
      child.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)))
      child.on('message', (message: WorkerResponse) => {
        if ('ready' in message) {
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
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${tool} took longer than ${CALL_TIMEOUT_MS / 1000} seconds`))
      }, CALL_TIMEOUT_MS)
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

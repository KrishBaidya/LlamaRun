import type { Readable, Writable } from 'node:stream'
import { createInterface } from 'node:readline'

type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>

interface RpcMessage {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code = -32000,
    readonly data?: unknown
  ) {
    super(message)
  }
}

/** Newline-delimited JSON-RPC 2.0 peer (mirror of JsonRpcPeer in plugin_host.py). */
export class JsonRpcPeer {
  private nextId = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private closed = false

  constructor(
    input: Readable,
    private output: Writable,
    private handlers: Record<string, Handler>,
    private onNotification: (method: string, params: Record<string, unknown>) => void = () => {}
  ) {
    const rl = createInterface({ input, crlfDelay: Infinity })
    rl.on('line', (line) => this.onLine(line))
    rl.on('close', () => this.close(new RpcError('plugin host exited')))
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError('plugin host is not running'))
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  /** Fire-and-forget message to the plugin. */
  notify(method: string, params: Record<string, unknown> = {}): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  close(reason: Error): void {
    if (this.closed) return
    this.closed = true
    for (const { reject } of this.pending.values()) reject(reason)
    this.pending.clear()
  }

  private send(msg: RpcMessage): void {
    if (this.closed) return
    this.output.write(JSON.stringify(msg) + '\n')
  }

  private onLine(line: string): void {
    let msg: RpcMessage
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.method) {
      if (msg.id === undefined || msg.id === null) this.onNotification(msg.method, msg.params ?? {})
      else void this.handleRequest(msg)
      return
    }
    const entry = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined
    if (!entry) return
    this.pending.delete(msg.id as number)
    if (msg.error) entry.reject(new RpcError(msg.error.message, msg.error.code, msg.error.data))
    else entry.resolve(msg.result)
  }

  private async handleRequest(msg: RpcMessage): Promise<void> {
    const handler = this.handlers[msg.method!]
    try {
      if (!handler) throw new RpcError(`method not found: ${msg.method}`, -32601)
      const result = await handler(msg.params ?? {})
      this.send({ jsonrpc: '2.0', id: msg.id, result: result ?? null })
    } catch (err) {
      const e = err as RpcError
      this.send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32000, message: e.message ?? String(err) } })
    }
  }
}

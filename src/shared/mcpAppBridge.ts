import type { McpAppCsp, McpAppRef } from './types'
import { contextText, MCP_APPS_PROTOCOL } from './mcpApps'

/**
 * Llama Run's side of an MCP App's conversation (SEP-1865): the view sends
 * JSON-RPC requests and notifications with postMessage, and the host answers,
 * proxies tool calls and resource reads to the view's own server, and sends
 * the tool's input and result once the view has initialized.
 */

export type DisplayMode = 'inline' | 'fullscreen'

interface RpcMessage {
  jsonrpc?: string
  id?: string | number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: unknown
}

export interface BridgeDeps {
  /** Sends a message to the view. */
  post(message: Record<string, unknown>): void
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
  readResource(uri: string): Promise<unknown>
  listTools(): Promise<unknown>
  listResources(): Promise<unknown>
  /** The app asked to be closed (ui/notifications/request-teardown). */
  close(): void
  openLink(url: string): void
  /** ui/message: text the app writes in the chat as the user. */
  message(text: string): void
  /** ui/update-model-context: what the app wants the model to know from now on. */
  setContext(text: string): void
  requestMode(mode: DisplayMode): DisplayMode
  /** Whether the user just clicked or typed in the app: only then may it change how it's shown. */
  hasGesture(): boolean
  resized(width: number | undefined, height: number | undefined): void
  /** The app offers tools of its own (now, or changed): the host should list them again. */
  toolsChanged?(): void
  log?(level: string, data: unknown): void
}

export interface HostContext {
  theme: 'light' | 'dark'
  displayMode: DisplayMode
  containerDimensions: Record<string, number>
  styles?: { variables?: Record<string, string> }
  locale?: string
  timeZone?: string
}

export class McpAppBridge {
  private initialized = false
  private nextId = 1
  /** The modes the app said it supports; empty means it didn't say. */
  private appModes: string[] = []
  /** It said it has tools of its own (appCapabilities.tools). */
  private appHasTools = false
  /** Requests sent to the view, waiting for its answer. */
  private waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  constructor(
    private app: McpAppRef,
    private csp: McpAppCsp,
    private deps: BridgeDeps,
    private context: HostContext
  ) {}

  private reply(id: string | number, result: unknown): void {
    this.deps.post({ jsonrpc: '2.0', id, result })
  }

  private fail(id: string | number, message: string, code = -32000): void {
    this.deps.post({ jsonrpc: '2.0', id, error: { code, message } })
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.deps.post({ jsonrpc: '2.0', method, params })
  }

  /** One message from the view. */
  async handle(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return
    const msg = raw as RpcMessage
    if (typeof msg.method !== 'string') {
      // An answer to a request the host sent (tools/list, tools/call, teardown).
      const entry = msg.id !== undefined ? this.waiting.get(String(msg.id)) : undefined
      if (!entry) return
      this.waiting.delete(String(msg.id))
      clearTimeout(entry.timer)
      if (msg.error !== undefined) entry.reject(new Error(String((msg.error as { message?: unknown })?.message ?? 'The app failed')))
      else entry.resolve(msg.result)
      return
    }
    const params = msg.params ?? {}
    const id = msg.id
    if (id === undefined) return this.onNotification(msg.method, params)
    try {
      this.reply(id, await this.onRequest(msg.method, params))
    } catch (err) {
      const e = err as Error & { code?: number }
      this.fail(id, e.message || 'Failed', e.code)
    }
  }

  private async onRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'ui/initialize': {
        const caps = (params.appCapabilities ?? params.capabilities ?? {}) as { availableDisplayModes?: unknown; tools?: unknown }
        this.appModes = Array.isArray(caps.availableDisplayModes) ? caps.availableDisplayModes.map(String) : []
        this.appHasTools = Boolean(caps.tools)
        return {
          protocolVersion: MCP_APPS_PROTOCOL,
          hostInfo: { name: 'Llama Run', version: '1' },
          hostCapabilities: {
            openLinks: {},
            serverTools: {},
            serverResources: {},
            logging: {},
            message: { text: {} },
            updateModelContext: { text: {}, structuredContent: {} },
            sandbox: { csp: this.csp }
          },
          hostContext: {
            ...this.context,
            // The SDK checks this against MCP's Tool shape, so inputSchema has to be there.
            toolInfo: { tool: this.app.toolDef ?? { name: this.app.tool, inputSchema: { type: 'object' } } },
            availableDisplayModes: ['inline', 'fullscreen'],
            platform: 'desktop'
          }
        }
      }
      case 'ping':
        return {}
      case 'tools/call': {
        const name = String(params.name ?? '')
        if (!name) throw Object.assign(new Error('name is required'), { code: -32602 })
        return await this.deps.callTool(name, (params.arguments as Record<string, unknown>) ?? {})
      }
      case 'tools/list':
        return await this.deps.listTools()
      case 'resources/read':
        return await this.deps.readResource(String(params.uri ?? ''))
      case 'resources/list':
        return await this.deps.listResources()
      case 'ui/open-link': {
        const url = String(params.url ?? '')
        if (!/^https?:\/\//i.test(url)) throw new Error('Invalid URL')
        this.deps.openLink(url)
        return {}
      }
      case 'ui/message': {
        const content = params.content as { type?: string; text?: string } | { type?: string; text?: string }[] | undefined
        const blocks = Array.isArray(content) ? content : content ? [content] : []
        const text = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
        if (!text) throw new Error('Invalid message format')
        this.deps.message(text)
        return {}
      }
      case 'ui/update-model-context':
        this.deps.setContext(contextText(params))
        return {}
      case 'ui/request-display-mode': {
        const wanted = params.mode === 'fullscreen' ? 'fullscreen' : params.mode === 'inline' ? 'inline' : null
        // Never a mode the app didn't list (when it listed any), nor one Llama Run doesn't have.
        if (!wanted || (this.appModes.length && !this.appModes.includes(wanted))) return { mode: this.context.displayMode }
        // Like Claude: an app can't take over the screen on its own, only right after a click or key press in it.
        if (wanted !== this.context.displayMode && !this.deps.hasGesture()) return { mode: this.context.displayMode }
        return { mode: this.deps.requestMode(wanted) }
      }
      default:
        throw Object.assign(new Error(`Unsupported method ${method}`), { code: -32601 })
    }
  }

  private onNotification(method: string, params: Record<string, unknown>): void {
    if (method === 'ui/notifications/initialized') {
      if (this.initialized) return
      this.initialized = true
      this.notify('ui/notifications/tool-input', { arguments: this.app.args ?? {} })
      if (this.app.result) this.notify('ui/notifications/tool-result', this.app.result as unknown as Record<string, unknown>)
      if (this.appHasTools) this.deps.toolsChanged?.()
    } else if (method === 'ui/notifications/size-changed') {
      const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
      this.deps.resized(n(params.width), n(params.height))
    } else if (method === 'notifications/tools/list_changed') {
      if (this.appHasTools) this.deps.toolsChanged?.()
    } else if (method === 'ui/notifications/request-teardown') {
      this.deps.close()
    } else if (method === 'notifications/message') {
      this.deps.log?.(String(params.level ?? 'info'), params.data)
    }
  }

  /** Sends the view a request and waits for its answer. */
  private request(method: string, params: Record<string, unknown>, timeoutMs = 60_000): Promise<unknown> {
    if (!this.initialized) return Promise.reject(new Error('The app is still loading'))
    const id = `host-${this.nextId++}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error("The app didn't answer"))
      }, timeoutMs)
      this.waiting.set(id, { resolve, reject, timer })
      this.deps.post({ jsonrpc: '2.0', id, method, params })
    })
  }

  /** The tools the app offers (MCP tools/list sent to the view). */
  async listAppTools(): Promise<unknown[]> {
    if (!this.appHasTools) return []
    const result = (await this.request('tools/list', {})) as { tools?: unknown }
    return Array.isArray(result?.tools) ? result.tools : []
  }

  /** Runs one of the app's own tools (MCP tools/call sent to the view). */
  callAppTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request('tools/call', { name, arguments: args }, 120_000)
  }

  /** Theme, size or display mode changed: tells the view, once it is listening. */
  contextChanged(partial: Partial<HostContext>): void {
    this.context = { ...this.context, ...partial }
    if (this.initialized) this.notify('ui/notifications/host-context-changed', partial as Record<string, unknown>)
  }

  /** Before the view goes away (spec: ui/resource-teardown). Doesn't wait for the answer. */
  teardown(reason: string): void {
    for (const entry of this.waiting.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('The app was closed'))
    }
    this.waiting.clear()
    if (this.initialized) this.deps.post({ jsonrpc: '2.0', id: `teardown-${this.nextId++}`, method: 'ui/resource-teardown', params: { reason } })
  }
}

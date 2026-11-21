import { EventEmitter } from 'node:events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { McpAppRef, McpAppResource, McpServerConfig, McpServerStatus, McpToolInfo, SlashCommand } from '@shared/types'
import { cleanCsp, MCP_APP_MIME, MCP_APPS_EXTENSION, toolUiMeta, type McpAppToolMeta } from '@shared/mcpApps'
import { loadMcpConfig, saveMcpConfig } from './config'
import { forgetSignIn, McpOAuthProvider } from './oauth'

/** A server that needs the user to sign in before it can connect. */
class SignInNeeded extends Error {}

interface McpPrompt {
  name: string
  description: string
  args: { name: string; required: boolean }[]
}

interface Connection {
  config: McpServerConfig
  client?: Client
  status: McpServerStatus
  /** The tools the model sees (not those only the server's app may call). */
  tools: McpToolInfo[]
  /** Each tool's MCP Apps metadata, app-only tools included. */
  ui?: Map<string, McpAppToolMeta>
  /** Every tool's definition as the server listed it, for apps (toolInfo, tools/list). */
  defs?: Map<string, AppToolDef>
  /** The server's prompts, offered as /server:prompt commands like Claude Code's /mcp__server__prompt. */
  prompts?: McpPrompt[]
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Keeps the last few KB a server wrote to stderr, to explain why it failed. */
class StderrTail {
  private text = ''
  push(chunk: Buffer | string): void {
    this.text = (this.text + chunk.toString()).slice(-4000)
  }
  /** The last few non-empty lines, ANSI colours removed. */
  lines(count = 3): string {
    return this.text
      .replace(/\x1b\[[0-9;]*m/g, '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-count)
      .join('\n')
  }
}

export interface McpToolResult {
  content: unknown[]
  isError?: boolean
  /**
   * Short text to show instead of this result once a later result that also
   * has one arrives (an old window state, say), so requests stay small.
   */
  superseded?: string
  /** agent_run: the calls the agent made, shown in the tool card. */
  steps?: import('@shared/types').ToolStep[]
  /** The tool has an MCP App: shown with the result. */
  app?: McpAppRef
}

type AppToolDef = NonNullable<McpAppRef['toolDef']> & { _meta?: Record<string, unknown> }

/** Most characters of an app's arguments and structured result kept in the chat file. */
const MAX_APP_DATA = 200_000
const fits = (v: unknown): boolean => {
  try {
    return JSON.stringify(v ?? null).length <= MAX_APP_DATA
  } catch {
    return false
  }
}

/**
 * Keeps one live client per configured server and caches its tool list,
 * so prompts and plugins don't reconnect on every generation.
 */
class McpManager extends EventEmitter<{ changed: [McpServerStatus[]] }> {
  private connections = new Map<string, Connection>()
  private generation = 0

  servers(): McpServerConfig[] {
    return loadMcpConfig()
  }

  statuses(): McpServerStatus[] {
    return [...this.connections.values()].map((c) => c.status)
  }

  /**
   * Every connected server's tools, each name once: when two servers offer the
   * same name (two copies of one server, say), the first keeps it. Models reject
   * repeated names, and a call by name could only reach the first anyway.
   */
  tools(): McpToolInfo[] {
    const seen = new Set<string>()
    return [...this.connections.values()].flatMap((c) => c.tools.filter((t) => !seen.has(t.name) && seen.add(t.name)))
  }

  /**
   * Connect to every configured server, replacing existing connections.
   * `signIn` names a server that may open the browser to sign in (one the
   * user just added, or clicked Sign in on); others only say they need it.
   */
  async start(signIn?: string): Promise<void> {
    const gen = ++this.generation
    await this.stop()
    const servers = loadMcpConfig()
    for (const config of servers) {
      this.connections.set(config.name, {
        config,
        tools: [],
        status: { name: config.name, state: 'connecting', toolCount: 0 }
      })
    }
    this.emitChanged()
    await Promise.all(servers.map((s) => this.connect(s, gen, s.name === signIn)))
  }

  async stop(): Promise<void> {
    const old = [...this.connections.values()]
    this.connections.clear()
    await Promise.allSettled(old.map((c) => c.client?.close()))
  }

  async saveServer(server: McpServerConfig): Promise<void> {
    const servers = loadMcpConfig().filter((s) => s.name !== server.name)
    servers.push(server)
    saveMcpConfig(servers)
    await this.start(server.name)
  }

  async remove(name: string): Promise<void> {
    saveMcpConfig(loadMcpConfig().filter((s) => s.name !== name))
    forgetSignIn(name)
    await this.start()
  }

  /** Signs in to one server in the browser and connects it; the others stay as they are. */
  async signIn(name: string): Promise<void> {
    const config = loadMcpConfig().find((s) => s.name === name)
    const conn = this.connections.get(name)
    if (!config || !conn) throw new Error(`No MCP server called ${name}`)
    await conn.client?.close().catch(() => undefined)
    conn.client = undefined
    conn.status = { name, state: 'connecting', toolCount: 0 }
    this.emitChanged()
    await this.connect(config, this.generation, true)
  }

  /** Forgets a server's sign-in and reconnects it (it then asks to sign in again). */
  async signOut(name: string): Promise<void> {
    forgetSignIn(name)
    await this.start()
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const conn = [...this.connections.values()].find((c) => c.tools.some((t) => t.name === name))
    if (!conn?.client) throw new Error(`MCP tool not found: ${name}`)
    const result = await conn.client.callTool({ name, arguments: args })
    const content = (result.content as unknown[]) ?? []
    const uri = conn.ui?.get(name)?.resourceUri
    if (!uri) return { content, isError: Boolean(result.isError) }
    // The view gets the arguments and the full result, structuredContent included (the model only sees content).
    const appResult = { content, isError: Boolean(result.isError), ...(result.structuredContent !== undefined && fits(result.structuredContent) ? { structuredContent: result.structuredContent } : {}) }
    const def = conn.defs?.get(name)
    const app: McpAppRef = {
      server: conn.config.name,
      uri,
      tool: name,
      ...(def ? { toolDef: { name: def.name, ...(def.title ? { title: def.title } : {}), ...(def.description ? { description: def.description } : {}), inputSchema: def.inputSchema } } : {}),
      args: fits(args) ? args : {}, result: fits(appResult) ? appResult : { content: [], isError: appResult.isError } }
    // The model gets the result as text plus one fact: the user is looking at it in the app.
    const shown = { type: 'text', text: `[The user can see this result in the ${conn.config.name} app shown in the chat.]` }
    return { content: [...content, shown], isError: Boolean(result.isError), app }
  }

  private appConnection(server: string): Connection & { client: Client } {
    const conn = this.connections.get(server)
    if (!conn?.client) throw new Error(`${server} is not connected`)
    return conn as Connection & { client: Client }
  }

  /** An app's interface: its ui:// resource's HTML and what it may load. */
  async appResource(server: string, uri: string): Promise<McpAppResource> {
    if (!uri.startsWith('ui://')) throw new Error('Not an MCP App resource')
    const conn = this.appConnection(server)
    const read = await conn.client.readResource({ uri })
    const item = (read.contents ?? []).find((c) => c.uri === uri) ?? read.contents?.[0]
    if (!item) throw new Error(`${server} returned nothing for ${uri}`)
    if (item.mimeType && !item.mimeType.startsWith('text/html')) throw new Error(`${uri} is ${item.mimeType}, not an MCP App page`)
    const html = 'text' in item && typeof item.text === 'string' ? item.text : 'blob' in item && typeof item.blob === 'string' ? Buffer.from(item.blob, 'base64').toString('utf8') : ''
    if (!html) throw new Error(`${uri} has no HTML`)
    const ui = ((item._meta as { ui?: Record<string, unknown> } | undefined)?.ui ?? {}) as { csp?: McpAppResource['csp']; permissions?: Record<string, unknown>; prefersBorder?: unknown }
    const csp = cleanCsp(ui.csp)
    // The policy each app runs under, for anyone checking what an app may reach.
    console.info(`MCP App ${server} ${uri}: csp ${JSON.stringify(csp)}`)
    return {
      html,
      csp,
      permissions: Object.keys(ui.permissions ?? {}).filter((p) => ['camera', 'microphone', 'geolocation', 'clipboardWrite'].includes(p)),
      ...(typeof ui.prefersBorder === 'boolean' ? { prefersBorder: ui.prefersBorder } : {})
    }
  }

  /** A tool call from a server's own app: only that server's tools, and only those open to apps. */
  async appCallTool(server: string, name: string, args: Record<string, unknown>): Promise<{ content: unknown[]; structuredContent?: unknown; isError?: boolean }> {
    const conn = this.appConnection(server)
    const meta = conn.ui?.get(name)
    if (!meta) throw new Error(`${server} has no tool called ${name}`)
    if (!meta.visibility.includes('app')) throw new Error(`${name} is not available to apps`)
    const result = await conn.client.callTool({ name, arguments: args })
    return { content: (result.content as unknown[]) ?? [], isError: Boolean(result.isError), ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}) }
  }

  /** tools/list for a server's own app: the tools open to apps. */
  appListTools(server: string): { tools: AppToolDef[] } {
    const conn = this.appConnection(server)
    return { tools: [...(conn.defs?.values() ?? [])].filter((d) => conn.ui?.get(d.name)?.visibility.includes('app')) }
  }

  /** resources/list for a server's own app. */
  async appListResources(server: string): Promise<unknown> {
    return this.appConnection(server).client.listResources()
  }

  /** resources/read for a server's own app. */
  async appReadResource(server: string, uri: string): Promise<unknown> {
    return this.appConnection(server).client.readResource({ uri })
  }

  /** Every connected server's prompts as / commands. */
  commands(): SlashCommand[] {
    return [...this.connections.values()].flatMap((c) =>
      (c.prompts ?? []).map((p) => ({
        name: `${slug(c.config.name)}:${slug(p.name)}`,
        description: p.description || `${p.name} from ${c.config.name}`,
        kind: 'mcp' as const,
        plugin: `MCP · ${c.config.name}`,
        ...(p.args.length ? { args: p.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ') } : {})
      }))
    )
  }

  /**
   * A typed "/server:prompt args": the prompt's text from the server, with
   * the words after the command given to its arguments in order (the last
   * one gets the rest). Null when no server has that prompt.
   */
  async runPrompt(text: string): Promise<{ name: string; text: string } | null> {
    const m = /^\/([\w.-]+):([\w.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
    if (!m) return null
    const conn = [...this.connections.values()].find((c) => c.client && slug(c.config.name) === m[1].toLowerCase())
    const prompt = conn?.prompts?.find((p) => slug(p.name) === m[2].toLowerCase())
    if (!conn?.client || !prompt) return null
    const words = (m[3] ?? '').trim() ? (m[3] ?? '').trim().split(/\s+/) : []
    const args: Record<string, string> = {}
    prompt.args.forEach((a, i) => {
      const value = i === prompt.args.length - 1 ? words.slice(i).join(' ') : words[i]
      if (value) args[a.name] = value
    })
    const missing = prompt.args.filter((a) => a.required && !args[a.name])
    if (missing.length) throw new Error(`/${m[1]}:${m[2]} needs ${missing.map((a) => a.name).join(', ')}`)
    const result = await conn.client.getPrompt({ name: prompt.name, arguments: args })
    const parts = result.messages.map((msg) => {
      const c = msg.content as { type: string; text?: string; resource?: { text?: string; uri?: string } }
      const body = c.type === 'text' ? (c.text ?? '') : c.type === 'resource' ? (c.resource?.text ?? c.resource?.uri ?? '') : `[${c.type}]`
      return msg.role === 'assistant' ? `(Assistant:) ${body}` : body
    })
    return { name: `${m[1]}:${m[2]}`, text: parts.filter(Boolean).join('\n\n') }
  }

  serverForTool(name: string): string | undefined {
    return this.tools().find((t) => t.name === name)?.server
  }

  private async connect(config: McpServerConfig, gen: number, interactive = false): Promise<void> {
    // Says Llama Run can show MCP Apps, so servers send their tools' interfaces.
    const client = new Client({ name: 'LlamaRun', version: '1.0.0' }, { capabilities: { extensions: { [MCP_APPS_EXTENSION]: { mimeTypes: [MCP_APP_MIME] } } } })
    let status: McpServerStatus
    let tools: McpToolInfo[] = []
    const ui = new Map<string, McpAppToolMeta>()
    const defs = new Map<string, AppToolDef>()
    let prompts: McpPrompt[] = []
    const stderr = new StderrTail()
    try {
      if (config.mcpType === 'STDIO') {
        if (!config.data.Command) throw new Error('No command configured')
        const transport = new StdioClientTransport({
          command: config.data.Command,
          args: config.data.Arguments ?? [],
          env: { ...getDefaultEnvironment(), ...(config.data.EnvironmentVariables ?? {}) },
          stderr: 'pipe'
        })
        // Must be read, or a chatty server blocks once the pipe buffer fills.
        transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
        await client.connect(transport)
      } else {
        if (!config.data.URL) throw new Error('No URL configured')
        const url = new URL(config.data.URL)
        const auth = new McpOAuthProvider(config.name, interactive)
        // Waits for the browser, then finishes signing in on the transport that asked.
        const finish = async (transport: { finishAuth(code: string): Promise<void> }): Promise<void> => {
          if (!interactive || !auth.code) throw new SignInNeeded('Sign in to use this server.')
          this.setStatus(config.name, gen, { name: config.name, state: 'signin', toolCount: 0, error: 'Finish signing in in your browser.' })
          await transport.finishAuth(await auth.code)
        }
        const streamable = new StreamableHTTPClientTransport(url, { authProvider: auth })
        try {
          await client.connect(streamable)
        } catch (err) {
          if (err instanceof UnauthorizedError) {
            await finish(streamable)
            await client.connect(new StreamableHTTPClientTransport(url, { authProvider: auth }))
          } else {
            // Older servers only speak SSE.
            const sse = new SSEClientTransport(url, { authProvider: auth })
            try {
              await client.connect(sse)
            } catch (sseErr) {
              if (!(sseErr instanceof UnauthorizedError)) throw sseErr
              await finish(sse)
              await client.connect(new SSEClientTransport(url, { authProvider: auth }))
            }
          }
        }
      }
      const listed = await client.listTools()
      for (const t of listed.tools) {
        ui.set(t.name, toolUiMeta(t._meta))
        const schema = (t.inputSchema ?? {}) as Record<string, unknown>
        defs.set(t.name, {
          name: t.name,
          ...(t.title ? { title: t.title } : {}),
          ...(t.description ? { description: t.description } : {}),
          inputSchema: { ...schema, type: 'object' },
          ...(t._meta ? { _meta: t._meta as Record<string, unknown> } : {})
        })
      }
      // Tools only the server's own app may call are kept from the model.
      tools = listed.tools
        .filter((t) => ui.get(t.name)!.visibility.includes('model'))
        .map((t) => ({
          name: t.name,
          description: t.description ?? '',
          server: config.name,
          inputSchema: t.inputSchema as Record<string, unknown>
        }))
      if (client.getServerCapabilities()?.prompts) {
        const listed = await client.listPrompts().catch(() => null)
        prompts = (listed?.prompts ?? []).map((p) => ({
          name: p.name,
          description: p.description ?? '',
          args: (p.arguments ?? []).map((a) => ({ name: a.name, required: Boolean(a.required) }))
        }))
      }
      status = { name: config.name, state: 'connected', toolCount: tools.length }
    } catch (err) {
      await client.close().catch(() => undefined)
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof SignInNeeded || err instanceof UnauthorizedError) {
        status = { name: config.name, state: 'signin', toolCount: 0, error: err instanceof SignInNeeded ? message : 'Sign in to use this server.' }
      } else {
      // "Connection closed" alone says nothing; the server's own output usually does.
      const detail = stderr.lines()
      if (detail) console.warn(`MCP server ${config.name} failed:\n${detail}`)
      status = {
        name: config.name,
        state: 'error',
        toolCount: 0,
        error: detail ? `${message}\n${detail}` : message
      }
      }
    }

    const conn = this.connections.get(config.name)
    if (gen !== this.generation || !conn) {
      // A newer start() replaced this connection while we were connecting.
      await client.close().catch(() => undefined)
      return
    }
    conn.status = status
    conn.tools = tools
    conn.ui = ui
    conn.defs = defs
    conn.prompts = prompts
    if (status.state === 'connected') conn.client = client
    this.emitChanged()
  }

  /** A status while still connecting, if this connection is still the current one. */
  private setStatus(name: string, gen: number, status: McpServerStatus): void {
    const conn = this.connections.get(name)
    if (gen !== this.generation || !conn) return
    conn.status = status
    this.emitChanged()
  }

  private emitChanged(): void {
    this.emit('changed', this.statuses())
  }
}

export const mcp = new McpManager()

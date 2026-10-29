import { EventEmitter } from 'node:events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServerConfig, McpServerStatus, McpToolInfo } from '@shared/types'
import { loadMcpConfig, saveMcpConfig } from './config'

interface Connection {
  config: McpServerConfig
  client?: Client
  status: McpServerStatus
  tools: McpToolInfo[]
}

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

  tools(): McpToolInfo[] {
    return [...this.connections.values()].flatMap((c) => c.tools)
  }

  /** Connect to every configured server, replacing existing connections. */
  async start(): Promise<void> {
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
    await Promise.all(servers.map((s) => this.connect(s, gen)))
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
    await this.start()
  }

  async remove(name: string): Promise<void> {
    saveMcpConfig(loadMcpConfig().filter((s) => s.name !== name))
    await this.start()
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const conn = [...this.connections.values()].find((c) => c.tools.some((t) => t.name === name))
    if (!conn?.client) throw new Error(`MCP tool not found: ${name}`)
    const result = await conn.client.callTool({ name, arguments: args })
    return { content: (result.content as unknown[]) ?? [], isError: Boolean(result.isError) }
  }

  serverForTool(name: string): string | undefined {
    return this.tools().find((t) => t.name === name)?.server
  }

  private async connect(config: McpServerConfig, gen: number): Promise<void> {
    const client = new Client({ name: 'LlamaRun', version: '1.0.0' })
    let status: McpServerStatus
    let tools: McpToolInfo[] = []
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
        try {
          await client.connect(new StreamableHTTPClientTransport(url))
        } catch {
          await client.connect(new SSEClientTransport(url))
        }
      }
      const listed = await client.listTools()
      tools = listed.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        server: config.name,
        inputSchema: t.inputSchema as Record<string, unknown>
      }))
      status = { name: config.name, state: 'connected', toolCount: tools.length }
    } catch (err) {
      await client.close().catch(() => undefined)
      const message = err instanceof Error ? err.message : String(err)
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

    const conn = this.connections.get(config.name)
    if (gen !== this.generation || !conn) {
      // A newer start() replaced this connection while we were connecting.
      await client.close().catch(() => undefined)
      return
    }
    conn.status = status
    conn.tools = tools
    if (status.state === 'connected') conn.client = client
    this.emitChanged()
  }

  private emitChanged(): void {
    this.emit('changed', this.statuses())
  }
}

export const mcp = new McpManager()

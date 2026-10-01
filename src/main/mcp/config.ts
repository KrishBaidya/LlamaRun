import type { McpServerConfig } from '@shared/types'
import { readJson, writeJson } from '../jsonFile'
import { mcpConfigPath } from '../paths'

/** mcp.json keeps the WinUI app's shape: a bare array of servers. */
export function loadMcpConfig(): McpServerConfig[] {
  const raw = readJson<unknown>(mcpConfigPath(), [])
  return Array.isArray(raw) ? raw.filter(isServerConfig) : []
}

export function saveMcpConfig(servers: McpServerConfig[]): void {
  writeJson(mcpConfigPath(), servers)
}

export function isServerConfig(v: unknown): v is McpServerConfig {
  if (!v || typeof v !== 'object') return false
  const s = v as McpServerConfig
  return (
    typeof s.name === 'string' &&
    s.name.trim() !== '' &&
    (s.mcpType === 'STDIO' || s.mcpType === 'SSE') &&
    !!s.data &&
    typeof s.data === 'object'
  )
}

/**
 * Converts a directory entry's `serverConfig` ({mcpServer:{command,args,env,url}},
 * or the common {mcpServers:{name:{...}}} form) into an mcp.json entry.
 */
export function configFromDirectoryEntry(name: string, serverConfig: unknown): McpServerConfig {
  let parsed = serverConfig
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = {}
    }
  }
  const obj = (parsed ?? {}) as Record<string, unknown>
  let cfg: Record<string, unknown>
  if (obj.mcpServer && typeof obj.mcpServer === 'object') {
    cfg = obj.mcpServer as Record<string, unknown>
  } else if (obj.mcpServers && typeof obj.mcpServers === 'object') {
    cfg = (Object.values(obj.mcpServers as Record<string, unknown>)[0] ?? {}) as Record<string, unknown>
  } else {
    cfg = obj
  }

  const url = typeof cfg.url === 'string' ? cfg.url : null
  const env =
    cfg.env && typeof cfg.env === 'object'
      ? Object.fromEntries(Object.entries(cfg.env as object).map(([k, v]) => [k, String(v)]))
      : {}
  return {
    name,
    mcpType: url && !cfg.command ? 'SSE' : 'STDIO',
    data: {
      Command: typeof cfg.command === 'string' ? cfg.command : null,
      Arguments: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
      EnvironmentVariables: env,
      URL: url
    }
  }
}

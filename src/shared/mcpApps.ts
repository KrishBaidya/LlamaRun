import type { McpAppCsp } from './types'

/**
 * MCP Apps (the io.modelcontextprotocol/ui extension, SEP-1865): an MCP
 * server ships an HTML interface for a tool as a ui:// resource, and the host
 * shows it with the tool's result in a sandboxed frame. These helpers are the
 * parts both processes need.
 */

export const MCP_APPS_EXTENSION = 'io.modelcontextprotocol/ui'
export const MCP_APP_MIME = 'text/html;profile=mcp-app'
export const MCP_APPS_PROTOCOL = '2026-01-26'

/** What a tool's _meta says about its interface: the resource to show and who may call it. */
export interface McpAppToolMeta {
  resourceUri?: string
  /** "model": the model sees it; "app": its interface may call it. Default both. */
  visibility: ('model' | 'app')[]
}

export function toolUiMeta(meta: unknown): McpAppToolMeta {
  const m = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>
  const ui = (m.ui && typeof m.ui === 'object' ? m.ui : {}) as { resourceUri?: unknown; visibility?: unknown }
  // The flat "ui/resourceUri" key is the deprecated form, still sent by older servers.
  const uri = typeof ui.resourceUri === 'string' ? ui.resourceUri : typeof m['ui/resourceUri'] === 'string' ? (m['ui/resourceUri'] as string) : undefined
  const visibility = Array.isArray(ui.visibility) ? ui.visibility.filter((v): v is 'model' | 'app' => v === 'model' || v === 'app') : []
  return { ...(uri && uri.startsWith('ui://') ? { resourceUri: uri } : {}), visibility: visibility.length ? visibility : ['model', 'app'] }
}

/** An origin a CSP may name: scheme, host (a leading *. allowed) and optional port, nothing that could end the directive. */
const ORIGIN = /^(https?|wss?):\/\/(\*\.)?[a-z0-9.-]+(:\d{1,5})?$/i

const origins = (list: string[] | undefined): string[] => (list ?? []).filter((o) => typeof o === 'string' && ORIGIN.test(o.trim())).map((o) => o.trim())

/**
 * The Content-Security-Policy for an app: only the origins its server
 * declared, and the spec's restrictive defaults for anything it didn't.
 */
export function appCsp(csp: McpAppCsp | undefined): string {
  const res = origins(csp?.resourceDomains).join(' ')
  const connect = origins(csp?.connectDomains)
  const frames = origins(csp?.frameDomains)
  const bases = origins(csp?.baseUriDomains)
  const src = (extra: string): string => [extra, res].filter(Boolean).join(' ')
  return [
    "default-src 'none'",
    `script-src ${src("'self' 'unsafe-inline' blob:")}`,
    `style-src ${src("'self' 'unsafe-inline'")}`,
    `img-src ${src("'self' data: blob:")}`,
    `font-src ${src("'self' data:")}`,
    `media-src ${src("'self' data: blob:")}`,
    `connect-src ${connect.length ? connect.join(' ') : "'none'"}`,
    `frame-src ${frames.length ? frames.join(' ') : "'none'"}`,
    `base-uri ${bases.length ? bases.join(' ') : "'self'"}`,
    "object-src 'none'",
    "form-action 'none'"
  ].join('; ')
}

/** The CSP domains as passed on, keeping only valid origins (what the host actually allows). */
export function cleanCsp(csp: McpAppCsp | undefined): McpAppCsp {
  const out: McpAppCsp = {}
  for (const key of ['connectDomains', 'resourceDomains', 'frameDomains', 'baseUriDomains'] as const) {
    const list = origins(csp?.[key])
    if (list.length) out[key] = list
  }
  return out
}

/** ui/update-model-context's content blocks and structured content as text. */
export function contextText(params: { content?: unknown; structuredContent?: unknown }): string {
  const blocks = Array.isArray(params.content) ? params.content : []
  const text = blocks
    .map((b) => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
  const structured = params.structuredContent !== undefined ? JSON.stringify(params.structuredContent) : ''
  return [text, structured].filter(Boolean).join('\n')
}

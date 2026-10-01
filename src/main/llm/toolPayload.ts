import type { McpToolInfo } from '@shared/types'
import type { McpToolResult } from '../mcp/manager'

/** Tool definition in the shape both backends send: name, description, JSON Schema. */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** Longest tool result sent back to the model; the rest is cut with a note. */
export const MAX_TOOL_RESULT_CHARS = 16_000

/** Schema keys models never need; MCP servers (FastMCP in particular) add `title` to every property. */
const SCHEMA_NOISE = new Set(['$schema', '$id', '$comment', 'title', 'examples'])

function compactSchema(value: unknown, isPropertyMap = false): unknown {
  if (Array.isArray(value)) return value.map((v) => compactSchema(v))
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    // Inside `properties`, keys are parameter names (a parameter may be called "title").
    if (!isPropertyMap && SCHEMA_NOISE.has(key)) continue
    out[key] = compactSchema(v, !isPropertyMap && (key === 'properties' || key === 'patternProperties'))
  }
  return out
}

/** Collapses the indentation and blank lines of docstring-style descriptions. */
function compactText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

const specCache = new WeakMap<McpToolInfo, ToolSpec>()

/**
 * The tool list sent with every request. It goes out again on each tool round
 * (the backends are stateless), so it's kept as small as possible and cached
 * per tool until the MCP server reconnects.
 */
export function toolSpecs(tools: McpToolInfo[]): ToolSpec[] {
  return tools.map((tool) => {
    let spec = specCache.get(tool)
    if (!spec) {
      spec = {
        name: tool.name,
        description: compactText(tool.description),
        parameters: compactSchema(tool.inputSchema ?? { type: 'object' }) as Record<string, unknown>
      }
      specCache.set(tool, spec)
    }
    return spec
  })
}

/**
 * A tool result as text for the model. Images and other binary content become
 * a short placeholder instead of base64 the model can't use, and long output is
 * truncated, since every later round sends all earlier results again.
 */
export function toolResultToText(result: McpToolResult, limit = MAX_TOOL_RESULT_CHARS): string {
  const parts = result.content.map((c) => {
    const item = c as { type?: string; text?: string; mimeType?: string; resource?: { uri?: string; text?: string } }
    if (item.type === 'text' && typeof item.text === 'string') return item.text
    if (item.type === 'image' || item.type === 'audio') return `[${item.type} ${item.mimeType ?? ''}]`.replace(' ]', ']')
    if (item.type === 'resource' && item.resource) return item.resource.text ?? `[resource ${item.resource.uri ?? ''}]`
    if (item.type === 'resource_link') return `[resource ${(item as { uri?: string }).uri ?? ''}]`
    return JSON.stringify(item)
  })
  const text = (result.isError ? 'Tool error: ' : '') + parts.join('\n')
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} characters]`
}

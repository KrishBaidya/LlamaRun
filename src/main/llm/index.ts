import type { ModelCatalog } from '@shared/types'
import { auth } from '../auth'
import { mcp } from '../mcp/manager'
import { generateCloud } from './cloud'
import { isCloudModel, loadCloudCatalog } from './models'
import { generateOllama, isOllamaRunning, listOllamaModels } from './ollama'
import { GenerationError, type GenerateInput, type GenerateOptions, type ToolBridge } from './types'

export { GenerationError, MAX_TOOL_ROUNDS, type HistoryMessage, type ToolPause } from './types'
export { isCloudModel, loadCloudCatalog } from './models'

/**
 * Cloud groups come from the server-driven catalog. It is served from a 10-minute cache
 * unless `force` is set (the Models page Refresh button), which always hits the server.
 */
export async function modelCatalog({ force = false }: { force?: boolean } = {}): Promise<ModelCatalog> {
  const [cloud, running, ollama] = await Promise.all([
    loadCloudCatalog({ force }),
    isOllamaRunning(),
    listOllamaModels()
  ])
  return {
    groups: [...cloud.groups, { provider: 'ollama', label: 'Ollama (Local)', models: ollama }],
    ollamaRunning: running
  }
}

export async function availableModelIds(): Promise<string[]> {
  const catalog = await modelCatalog()
  return catalog.groups.flatMap((g) => g.models.map((m) => m.id))
}

export function mcpToolBridge(): ToolBridge | undefined {
  const tools = mcp.tools()
  if (!tools.length) return undefined
  return { tools, call: (name, args) => mcp.callTool(name, args) }
}

/**
 * Headless generation: returns the full text and streams tokens to `onToken`.
 * Never touches any window, so both the overlay and the plugin SDK use it.
 */
export async function generate(input: GenerateInput, opts: GenerateOptions): Promise<string> {
  if (!opts.model) throw new GenerationError('No model selected. Choose one in Settings.', 'NO_MODEL')
  if (isCloudModel(opts.model)) return generateCloud(input, { ...opts, token: auth.token })
  return generateOllama(input, opts)
}

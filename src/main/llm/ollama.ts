import { Ollama, type Message, type Tool } from 'ollama'
import type { ModelCapability, ModelInfo } from '@shared/types'
import { OLLAMA_HOST } from '@shared/constants'
import { toolSpecs } from './toolPayload'
import {
  GenerationError,
  MAX_TOOL_ROUNDS,
  toHistory,
  toolResultToText,
  type GenerateInput,
  type GenerateOptions,
  type ToolPause
} from './types'

type ToolCall = NonNullable<Message['tool_calls']>[number]

/** What an Ollama pause holds: the chat messages (ending with the assistant's tool request) and the calls not yet run. */
interface OllamaPauseState {
  messages: Message[]
  pending: ToolCall[]
}

function isConnectionError(err: unknown): boolean {
  const e = err as { cause?: { code?: string }; code?: string; message?: string }
  const code = e?.cause?.code ?? e?.code
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    /fetch failed|ECONNREFUSED/i.test(e?.message ?? '')
  )
}

export async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(OLLAMA_HOST, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

const KNOWN_CAPABILITIES = new Set<ModelCapability>(['tools', 'vision', 'thinking'])
/** Capabilities per model digest; they never change for a given digest. */
const capabilityCache = new Map<string, ModelCapability[]>()

async function capabilitiesOf(client: Ollama, name: string, digest: string): Promise<ModelCapability[] | undefined> {
  const cached = capabilityCache.get(digest)
  if (cached) return cached
  try {
    const info = (await client.show({ model: name })) as { capabilities?: string[] }
    const caps = (info.capabilities ?? []).filter((c): c is ModelCapability => KNOWN_CAPABILITIES.has(c as ModelCapability))
    capabilityCache.set(digest, caps)
    return caps
  } catch {
    return undefined
  }
}

/** "llama3.2:3b" -> "Llama3.2 3b"; keeps the tag so variants stay distinguishable. */
function prettyName(name: string): string {
  const [base, tag] = name.split(':')
  const title = base.split('/').pop()!.replace(/^\w/, (c) => c.toUpperCase())
  return tag && tag !== 'latest' ? `${title} ${tag}` : title
}

export async function listOllamaModels(): Promise<ModelInfo[]> {
  try {
    const client = new Ollama({ host: OLLAMA_HOST })
    const { models } = await client.list()
    return await Promise.all(
      models.map(async (m): Promise<ModelInfo> => ({
        id: m.name,
        name: prettyName(m.name),
        provider: 'ollama',
        cloud: false,
        size: m.size,
        parameters: m.details?.parameter_size || undefined,
        quantization: m.details?.quantization_level || undefined,
        family: m.details?.family || undefined,
        modifiedAt: m.modified_at ? new Date(m.modified_at).getTime() : undefined,
        capabilities: await capabilitiesOf(client, m.name, m.digest)
      }))
    )
  } catch {
    return []
  }
}

export async function generateOllama(input: GenerateInput, opts: GenerateOptions): Promise<string> {
  const client = new Ollama({ host: OLLAMA_HOST })
  const onAbort = (): void => client.abort()
  opts.signal?.addEventListener('abort', onAbort)

  const resumed = opts.resume?.backend === 'ollama' ? (opts.resume.state as OllamaPauseState) : undefined
  const messages: Message[] = resumed
    ? [...resumed.messages]
    : [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        ...toHistory(input).map((m) => ({ role: m.role, content: m.content }))
      ]
  let tools: Tool[] | undefined = opts.tools?.tools.length
    ? toolSpecs(opts.tools.tools).map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters as Tool['function']['parameters'] }
      }))
    : undefined

  const bridge = opts.tools
  const runTools = async (calls: ToolCall[]): Promise<void> => {
    if (!bridge) return
    for (const call of calls) {
      const name = call.function.name
      opts.onTool?.(name, bridge.tools.find((t) => t.name === name)?.server ?? '')
      let text: string
      try {
        text = toolResultToText(await bridge.call(name, call.function.arguments ?? {}))
      } catch (err) {
        text = `Tool error: ${(err as Error).message}`
      }
      messages.push({ role: 'tool', content: text, tool_name: name })
    }
  }

  let output = ''
  try {
    if (resumed) await runTools(resumed.pending)
    for (let round = 0; !opts.signal?.aborted; round++) {
      // Without a way to pause, the last round goes without tools so the model has to answer.
      const roundTools = opts.onPause || round < MAX_TOOL_ROUNDS ? tools : undefined
      let stream
      try {
        stream = await client.chat({ model: opts.model, messages, tools: roundTools, stream: true })
      } catch (err) {
        // Models without tool support reject the request; retry as plain chat.
        if (roundTools && /does not support tools/i.test(String((err as Error)?.message))) {
          tools = undefined
          stream = await client.chat({ model: opts.model, messages, stream: true })
        } else throw err
      }

      let content = ''
      const toolCalls: NonNullable<Message['tool_calls']> = []
      for await (const chunk of stream) {
        if (chunk.message.content) {
          content += chunk.message.content
          output += chunk.message.content
          opts.onToken?.(chunk.message.content)
        }
        if (chunk.message.tool_calls?.length) toolCalls.push(...chunk.message.tool_calls)
      }

      if (!toolCalls.length || !bridge) return output
      messages.push({ role: 'assistant', content, tool_calls: toolCalls })
      if (round >= MAX_TOOL_ROUNDS) {
        const state: OllamaPauseState = { messages: [...messages], pending: toolCalls }
        opts.onPause?.({ backend: 'ollama', model: opts.model, state } satisfies ToolPause)
        return output
      }
      await runTools(toolCalls)
    }
    return output
  } catch (err) {
    if (opts.signal?.aborted) return output
    if (isConnectionError(err)) {
      throw new GenerationError('Ollama is not running. Install or start Ollama and try again.', 'OLLAMA_UNAVAILABLE')
    }
    throw new GenerationError((err as Error)?.message ?? String(err))
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

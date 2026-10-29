/**
 * Runs one benchmark task through Llama Run's own computer-use harness: the
 * same computer_* tools, instructions and tool loop the app uses, with the
 * driver reached over MCP (one `cua-driver mcp` inside the benchmark sandbox,
 * through bench/mcp-tcp.mjs) instead of the app's utility process.
 *
 *   node bench/dist/llamarun-agent.mjs --task "Click Submit" --model gemini-3.8-flash \
 *     --mcp-command '["node","bench/mcp-tcp.mjs","127.0.0.1","34861"]' --out result.json
 *
 * Env: CUA_MCP_TOKEN (for the MCP command), LLAMARUN_TOKEN (sign-in
 * token for Llama Run cloud models), OLLAMA_HOST for ollama/<model>.
 *
 * Models: "<id>" is a Llama Run cloud model (gemini-3.8-flash, ...) through
 * the Llama Run server; "gemini/<id>" the same Gemini model called directly
 * with GEMINI_API_KEY (or GOOGLE_API_KEY); "ollama/<name>" a local Ollama model; "script/<file.json>" replays a fixed
 * list of tool calls, to check the plumbing without a model.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { setDriverTransport } from '../src/main/computer/driver'
import type { DriverResult } from '../src/main/computer/protocol'
import { computer, computerInstructions, isComputerTool } from '../src/main/computer/tools'
import { generateCloud } from '../src/main/llm/cloud'
import { generateGemini, type GeminiUsage } from './gemini'
import { generateOllama } from '../src/main/llm/ollama'
import { toolResultToText } from '../src/main/llm/toolPayload'
import type { GenerateOptions, ToolBridge } from '../src/main/llm/types'

const { values } = parseArgs({
  options: {
    task: { type: 'string' },
    model: { type: 'string' },
    'mcp-command': { type: 'string' },
    'max-steps': { type: 'string', default: '50' },
    out: { type: 'string' }
  }
})
const task = values.task ?? ''
const model = values.model ?? ''
if (!task || !model || !values['mcp-command'] || !values.out) {
  console.error('Usage: --task <text> --model <id> --mcp-command <json array> --out <file> [--max-steps 50]')
  process.exit(2)
}

/** What the benchmark prompt adds to the task: there's no one to answer questions. */
export const BENCH_NOTE = 'Do this on the computer now, without asking questions: nobody can answer. When it is done, reply with a short summary.'

interface StepLog {
  tool: string
  args: Record<string, unknown>
  ms: number
  isError: boolean
  result: string
}

async function main(): Promise<void> {
  const client = new Client({ name: 'llamarun-bench', version: '1' })
  // One driver process for the whole task, as in the app: its screenshots and element cache stay valid between calls.
  const [command, ...args] = JSON.parse(values['mcp-command']!) as string[]
  await client.connect(new StdioClientTransport({ command, args, env: process.env as Record<string, string> }))
  // Cua Driver's MCP results carry the same fields as the SDK's ToolResult.
  setDriverTransport({
    async call(tool, args): Promise<DriverResult> {
      const r = await client.callTool({ name: tool, arguments: args })
      const content = (r.content as { type: string; text?: string; data?: string; mimeType?: string }[]) ?? []
      const structured = (r.structuredContent as Record<string, unknown> | undefined) ?? undefined
      const refusal = structured?.refusal as { code?: string } | undefined
      return {
        text: content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n'),
        images: content.filter((c) => c.type === 'image').map((c) => ({ mimeType: c.mimeType ?? 'image/png', data: c.data ?? '' })),
        structured,
        isError: Boolean(r.isError),
        errorCode: refusal?.code ?? (typeof structured?.code === 'string' ? structured.code : undefined)
      }
    },
    close: () => client.close()
  })

  const steps: StepLog[] = []
  const bridge: ToolBridge = {
    tools: computer.tools(),
    sequential: isComputerTool,
    // No chat id: approvals take the native path, which the stub answers "Allow once". Cloud models get text only, as in the app.
    call: async (name, args) => {
      const start = performance.now()
      const result = await computer.call(name, args, { screenshots: false })
      steps.push({ tool: name, args, ms: Math.round(performance.now() - start), isError: Boolean(result.isError), result: toolResultToText(result, 2000) })
      return result
    }
  }

  const prompt = `${task}\n\n${BENCH_NOTE}`
  const opts: GenerateOptions = { model, tools: bridge, system: computerInstructions(), maxToolRounds: Number(values['max-steps']) }
  const started = performance.now()
  let text = ''
  let error: string | undefined
  const usage: GeminiUsage = { inputTokens: 0, outputTokens: 0, requests: 0 }
  try {
    if (model.startsWith('script/')) {
      // Replays fixed tool calls: checks the sandbox, driver and tools without a model.
      // Placeholders: {{window:<title>}} is that window's id from an earlier result, {{quoted}} the task's quoted text.
      const calls = JSON.parse(readFileSync(model.slice('script/'.length), 'utf8')) as { name: string; args: Record<string, unknown> }[]
      const fill = (value: unknown): unknown => {
        if (typeof value !== 'string') return value
        const win = /^\{\{window:(.+)\}\}$/.exec(value)
        if (win) {
          const line = steps.map((s) => s.result).join('\n').split('\n').find((l) => l.includes(win[1]))
          return Number(/^(\d+):/.exec(line?.trim() ?? '')?.[1] ?? NaN)
        }
        return value.replace('{{quoted}}', /"([^"]+)"/.exec(task)?.[1] ?? '')
      }
      for (const call of calls) {
        await bridge.call(call.name, Object.fromEntries(Object.entries(call.args).map(([k, v]) => [k, fill(v)])))
      }
      text = 'scripted'
    } else if (model.startsWith('gemini/')) {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMNIN_KEY
      if (!apiKey) throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY or GEMNIN_KEY) is not set')
      text = await generateGemini(prompt, { ...opts, model: model.slice('gemini/'.length), apiKey }, usage)
    } else if (model.startsWith('ollama/')) {
      text = await generateOllama(prompt, { ...opts, model: model.slice('ollama/'.length) })
    } else {
      if (!process.env.LLAMARUN_TOKEN) throw new Error('LLAMARUN_TOKEN is not set (Llama Run cloud models need your sign-in token)')
      text = await generateCloud(prompt, { ...opts, token: process.env.LLAMARUN_TOKEN })
    }
  } catch (err) {
    error = (err as Error)?.message ?? String(err)
  }
  const result = {
    harness: 'llamarun',
    model,
    task,
    text,
    error,
    durationMs: Math.round(performance.now() - started),
    toolCalls: steps.length,
    toolErrors: steps.filter((s) => s.isError).length,
    toolMs: steps.reduce((sum, s) => sum + s.ms, 0),
    usage,
    steps
  }
  writeFileSync(values.out!, JSON.stringify(result, null, 2))
  console.log(`llamarun: ${steps.length} tool calls in ${result.durationMs} ms${error ? `, error: ${error}` : ''}`)
  await client.close().catch(() => undefined)
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)

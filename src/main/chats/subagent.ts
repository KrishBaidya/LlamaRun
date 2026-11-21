import type { McpToolInfo, ThinkingChoice, ToolStep } from '@shared/types'
import { READ_ONLY_TOOLS } from '../assistant/planMode'
import type { McpToolResult } from '../mcp/manager'
import type { GenerateInput, GenerateOptions, ToolBridge } from '../llm/types'
import { toolResultToText } from '../llm/types'

/**
 * agent_run: the model starts a sub-agent that carries out a task in its own
 * context, like Claude Code's Task, Codex's subagents, Hermes' delegate_tool
 * and OpenCode's task. Only the sub-agent's final answer comes back, so a long
 * job doesn't fill the parent's context. A sub-agent gets the chat's tools
 * (only the read-only ones in plan mode, or when the model asks for that) so
 * it can do the work, can't start sub-agents of its own, and its approvals go
 * to the parent chat's queue like any other call.
 */

export const AGENT_RUN = 'agent_run'
/** Sub-agents running at once across the app; more wait their turn. */
export const MAX_PARALLEL = 4
/** Tool rounds a sub-agent gets before it has to answer. */
const CHILD_ROUNDS = 20
/** Most characters of a sub-agent's answer the parent gets. */
const MAX_ANSWER = 12_000

/** Tools a sub-agent never gets. */
const NEVER = new Set([AGENT_RUN, 'ask_user', 'routine_create', 'routine_update', 'run_code'])

export function agentRunTool(): McpToolInfo {
  return {
    name: AGENT_RUN,
    server: 'Llama Run',
    description:
      "Start a sub-agent that carries out a task on its own, with a fresh context (it doesn't see this chat) and this chat's tools, except starting sub-agents and asking the user. Only its final answer comes back. Several calls in one turn run at the same time. read_only limits it to reading and looking things up.",
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The whole task: what to do, where, and what to report back.' },
        read_only: { type: 'boolean', description: 'Only reading and looking things up. Always on in plan mode.' }
      },
      required: ['task']
    }
  }
}

/** Waits for one of the MAX_PARALLEL slots. */
let active = 0
const waiting: (() => void)[] = []
async function slot(): Promise<() => void> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r))
  active++
  return () => {
    active--
    waiting.shift()?.()
  }
}

/** The tools a sub-agent gets from the parent's: all of them, or only the read-only ones; never the NEVER ones. */
export function childTools(tools: McpToolInfo[], readOnly: boolean): McpToolInfo[] {
  return tools.filter((t) => !NEVER.has(t.name) && (!readOnly || READ_ONLY_TOOLS.includes(t.name)))
}

export interface SubagentDeps {
  /** The parent chat's tools, made without agent_run. */
  bridge: ToolBridge | undefined
  model: string
  thinking?: ThinkingChoice
  signal?: AbortSignal
  generate: (input: GenerateInput, opts: GenerateOptions) => Promise<string>
  /** Plan mode: sub-agents only read. */
  readOnly?: boolean
}

const hintOf = (args: Record<string, unknown>): string | undefined => {
  const value = Object.values(args).find((v) => typeof v === 'string' && v.trim()) as string | undefined
  return value ? value.replace(/\s+/g, ' ').trim().slice(0, 60) : undefined
}

export async function runSubagent(args: Record<string, unknown>, deps: SubagentDeps): Promise<McpToolResult & { steps: ToolStep[] }> {
  const task = typeof args.task === 'string' ? args.task.trim() : ''
  if (!task) return { content: [{ type: 'text', text: 'task is required' }], isError: true, steps: [] }
  const readOnly = Boolean(deps.readOnly) || args.read_only === true

  const tools = deps.bridge ? childTools(deps.bridge.tools, readOnly) : []
  const allowed = new Set(tools.map((t) => t.name))
  const bridge: ToolBridge | undefined =
    deps.bridge && tools.length
      ? {
          tools,
          sequential: deps.bridge.sequential,
          call: (tool, a) =>
            allowed.has(tool) ? deps.bridge!.call(tool, a) : Promise.resolve({ content: [{ type: 'text', text: `${tool} is not available to this sub-agent.` }], isError: true })
        }
      : undefined
  const system =
    'Another assistant gave you this task and sees only your final answer, not your tool calls: end with everything it needs (what you did, findings, file paths, sources, what you could not do).'

  const steps: ToolStep[] = []
  const pending = new Map<string, ToolStep>()
  const release = await slot()
  try {
    if (deps.signal?.aborted) throw new Error('Stopped')
    const answer = await deps.generate(task, {
      model: deps.model,
      thinking: deps.thinking,
      signal: deps.signal,
      tools: bridge,
      system,
      maxToolRounds: CHILD_ROUNDS,
      onTool: (call) => {
        const step: ToolStep = { name: call.name, status: 'done', hint: hintOf(call.args) }
        pending.set(call.id, step)
        steps.push(step)
      },
      onToolResult: (id, result, error) => {
        const step = pending.get(id)
        if (step) step.status = error || !result || result.isError ? 'error' : 'done'
      }
    })
    const text = answer.trim() || '(the sub-agent gave no answer)'
    const cut = text.length > MAX_ANSWER ? `${text.slice(0, MAX_ANSWER)}\n…(answer cut)` : text
    return { content: [{ type: 'text', text: `Sub-agent (${steps.length} tool call${steps.length === 1 ? '' : 's'}):\n${cut}` }], steps }
  } catch (err) {
    return { content: [{ type: 'text', text: `The sub-agent failed: ${(err as Error).message}` }], isError: true, steps }
  } finally {
    release()
  }
}

/** For logs and tests: a result's text. */
export const answerText = (r: McpToolResult): string => toolResultToText(r, MAX_ANSWER + 200)

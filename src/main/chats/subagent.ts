import type { AgentInfo, McpToolInfo, ThinkingChoice, ToolStep } from '@shared/types'
import { READ_ONLY_TOOLS } from '../assistant/agents'
import type { McpToolResult } from '../mcp/manager'
import type { GenerateInput, GenerateOptions, ToolBridge } from '../llm/types'
import { toolResultToText } from '../llm/types'

/**
 * agent_run: hands a task to a child turn with its own context, like Claude
 * Code's Task, Codex's subagents, Hermes' delegate_tool and OpenCode's task.
 * Only the child's final answer comes back, so a broad search or a long
 * investigation doesn't fill the parent's context. Children get read-only
 * tools unless their agent file grants more, can't start children of their
 * own, and ask the user through the parent chat's approval queue.
 */

export const AGENT_RUN = 'agent_run'
/** Children running at once across the app; more wait their turn. */
export const MAX_PARALLEL = 4
/** Tool rounds a child gets before it has to answer. */
const CHILD_ROUNDS = 20
/** Most characters of a child's answer the parent gets. */
const MAX_ANSWER = 12_000

/** Tools a child never gets, whatever its agent allows. */
const NEVER = new Set([AGENT_RUN, 'ask_user', 'routine_create', 'routine_update', 'run_code'])

export function agentRunTool(agents: AgentInfo[]): McpToolInfo {
  const list = agents.length ? ` Agents:\n${agents.map((a) => `- ${a.name}: ${a.description || '(no description)'}`).join('\n')}` : ''
  return {
    name: AGENT_RUN,
    server: 'Llama Run',
    description: `Hand a self-contained task to a helper with its own fresh context (it doesn't see this chat): searching through many files or pages, researching a question, reviewing something. Only its final answer comes back, so describe the task fully and say what to report. Several calls in one turn run at the same time. Without agent, the helper can only read and look things up.${list}`,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The whole task: what to do, where, and what to report back.' },
        agent: { type: 'string', description: 'One of the agents by name. Default: a read-only helper.' }
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

/** The tools a child gets from the parent's: its agent's list (or read-only), never the NEVER ones. */
export function childTools(tools: McpToolInfo[], allowed: string[] | '*' | undefined): McpToolInfo[] {
  const names = allowed ?? READ_ONLY_TOOLS
  return tools.filter((t) => !NEVER.has(t.name) && (names === '*' || names.includes(t.name)))
}

export interface SubagentDeps {
  /** The parent chat's tools, made without agent_run. */
  bridge: ToolBridge | undefined
  model: string
  thinking?: ThinkingChoice
  signal?: AbortSignal
  generate: (input: GenerateInput, opts: GenerateOptions) => Promise<string>
  findAgent: (name: string) => AgentInfo | undefined
}

const hintOf = (args: Record<string, unknown>): string | undefined => {
  const value = Object.values(args).find((v) => typeof v === 'string' && v.trim()) as string | undefined
  return value ? value.replace(/\s+/g, ' ').trim().slice(0, 60) : undefined
}

export async function runSubagent(args: Record<string, unknown>, deps: SubagentDeps): Promise<McpToolResult & { steps: ToolStep[] }> {
  const task = typeof args.task === 'string' ? args.task.trim() : ''
  if (!task) return { content: [{ type: 'text', text: 'task is required' }], isError: true, steps: [] }
  const name = typeof args.agent === 'string' ? args.agent.trim() : ''
  const agent = name ? deps.findAgent(name) : undefined
  if (name && !agent) return { content: [{ type: 'text', text: `No agent called ${name}.` }], isError: true, steps: [] }

  const tools = deps.bridge ? childTools(deps.bridge.tools, agent?.tools) : []
  const allowed = new Set(tools.map((t) => t.name))
  const bridge: ToolBridge | undefined =
    deps.bridge && tools.length
      ? {
          tools,
          sequential: deps.bridge.sequential,
          call: (tool, a) =>
            allowed.has(tool) ? deps.bridge!.call(tool, a) : Promise.resolve({ content: [{ type: 'text', text: `${tool} is not available to this agent.` }], isError: true })
        }
      : undefined
  const system = [
    agent?.prompt,
    'Another assistant gave you this task and sees only your final answer, not your tool calls: end with everything it needs (findings, file paths, sources, what you could not do).'
  ]
    .filter(Boolean)
    .join('\n\n')

  const steps: ToolStep[] = []
  const pending = new Map<string, ToolStep>()
  const release = await slot()
  try {
    if (deps.signal?.aborted) throw new Error('Stopped')
    const answer = await deps.generate(task, {
      model: agent?.model || deps.model,
      thinking: agent?.thinking ?? deps.thinking,
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
    const text = answer.trim() || '(the agent gave no answer)'
    const cut = text.length > MAX_ANSWER ? `${text.slice(0, MAX_ANSWER)}\n…(answer cut)` : text
    return { content: [{ type: 'text', text: `${agent ? `${agent.name}` : 'Helper'} (${steps.length} tool call${steps.length === 1 ? '' : 's'}):\n${cut}` }], steps }
  } catch (err) {
    return { content: [{ type: 'text', text: `The agent failed: ${(err as Error).message}` }], isError: true, steps }
  } finally {
    release()
  }
}

/** For logs and tests: a result's text. */
export const answerText = (r: McpToolResult): string => toolResultToText(r, MAX_ANSWER + 200)

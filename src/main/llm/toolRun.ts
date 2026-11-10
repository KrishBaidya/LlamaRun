import { randomUUID } from 'node:crypto'
import type { McpToolResult } from '../mcp/manager'
import type { GenerateOptions, ToolBridge } from './types'

export interface PendingCall {
  name: string
  args: Record<string, unknown>
}

export interface CallOutcome {
  call: PendingCall
  /** The tool's result, or null when it threw. */
  result: McpToolResult | null
  error?: string
}

/**
 * Runs the tool calls a model asked for in one step and returns their
 * outcomes in the order asked. Calls run together when none of them acts on
 * the desktop (computer use runs one action at a time). Every call is
 * reported through onTool / onToolResult so the chat can show it in place.
 */
export async function runToolCalls(bridge: ToolBridge, calls: PendingCall[], opts: GenerateOptions): Promise<CallOutcome[]> {
  const runOne = async (call: PendingCall): Promise<CallOutcome> => {
    // Our own id: backends' call ids can repeat between rounds.
    const id = randomUUID()
    const server = bridge.tools.find((t) => t.name === call.name)?.server ?? ''
    opts.onTool?.({ id, name: call.name, server, args: call.args })
    try {
      const result = await bridge.call(call.name, call.args)
      opts.onToolResult?.(id, result)
      return { call, result }
    } catch (err) {
      const error = (err as Error)?.message ?? String(err)
      opts.onToolResult?.(id, null, error)
      return { call, result: null, error }
    }
  }
  const together = calls.length > 1 && !calls.some((c) => bridge.sequential?.(c.name))
  if (together) return Promise.all(calls.map(runOne))
  const outcomes: CallOutcome[] = []
  for (const call of calls) {
    if (opts.signal?.aborted) break
    outcomes.push(await runOne(call))
  }
  return outcomes
}

/**
 * Joins a new round's text onto the reply so far: rounds split by tool calls
 * get a paragraph break instead of running together ("Let me check.Done.").
 */
export function joinRound(output: string, text: string, newRound: boolean): string {
  if (!newRound || !output || /\n\s*$/.test(output)) return output + text
  return `${output}\n\n${text}`
}

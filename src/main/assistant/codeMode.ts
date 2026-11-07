import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { McpToolInfo } from '@shared/types'
import type { McpToolResult } from '../mcp/manager'
import { toolResultToText } from '../llm/toolPayload'
import type { ToolBridge } from '../llm/types'
import { pythonExecutable } from '../paths'
import { skillWorkspace } from '../skills/store'
import { askApproval } from './approval'
import { commandEnv } from './builtins'

/**
 * Code mode, like Hermes' execute_code and OpenCode's Code Mode: the model
 * writes a Python script that calls its own tools as functions, and only what
 * the script prints comes back. A loop over files or a chain of steps costs one
 * model turn instead of one per call, and the intermediate results never enter
 * the context.
 *
 * Tool calls reach the app over a loopback TCP connection (stdout is the
 * script's own) with a random token only this script gets. Each call goes
 * through the chat's own tools, so their approvals still apply.
 */

export const RUN_CODE = 'run_code'
/** How long a script may run unless the call says otherwise. */
const DEFAULT_TIMEOUT_S = 300
const MAX_TIMEOUT_S = 600
/** Tool calls one script may make. */
export const MAX_TOOL_CALLS = 50
/** What of a tool's result a script gets back. */
const MAX_RESULT_CHARS = 100_000
/** What of the script's output the model gets: head and tail, under what it's shown of a tool result. */
const OUTPUT_HEAD = 9000
const OUTPUT_TAIL = 5000

export const RUN_CODE_TOOL: McpToolInfo = {
  name: RUN_CODE,
  server: 'Llama Run',
  description: `Run a Python script with Llama Run's bundled Python, in the skill workspace folder. It can call your other tools as functions with keyword arguments: \`from llamarun_tools import read_file, render_html\`, then \`text = read_file(path="notes.txt")\` returns what the tool returns as text; a failed call raises llamarun_tools.ToolError. Only what the script prints comes back to you, so loops and multi-step work cost one call. Limits: ${DEFAULT_TIMEOUT_S / 60} minutes (timeout can raise it to ${MAX_TIMEOUT_S / 60}), ${MAX_TOOL_CALLS} tool calls.`,
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'The Python script.' },
      timeout: { type: 'integer', description: `Seconds before it is stopped (default ${DEFAULT_TIMEOUT_S}, at most ${MAX_TIMEOUT_S}).` }
    },
    required: ['code']
  }
}

/** Chats where the user allowed code for the rest of the chat. */
const allowedChats = new Set<string>()

/** A tool name as a Python identifier (MCP names can have dashes). */
export const pythonName = (name: string): string => (/^[A-Za-z_]/.test(name) ? name : `t_${name}`).replace(/[^A-Za-z0-9_]/g, '_')

/** The llamarun_tools module: a function per tool, each one call over the connection. */
export function toolsModule(names: string[]): string {
  const seen = new Set<string>()
  const defs = names
    .filter((n) => n !== RUN_CODE)
    .map((n) => [pythonName(n), n] as const)
    .filter(([py]) => !seen.has(py) && seen.add(py))
    .map(([py, n]) => `${py} = _tool(${JSON.stringify(n)})`)
  return `"""Llama Run's tools, callable from a script run with run_code."""
import itertools as _itertools
import json as _json
import os as _os
import socket as _socket

_ids = _itertools.count(1)
_file = None


class ToolError(Exception):
    """A tool call failed; the message says why."""


def _connection():
    global _file
    if _file is None:
        sock = _socket.create_connection(("127.0.0.1", int(_os.environ["LLAMARUN_TOOLS_PORT"])))
        _file = sock.makefile("rwb")
    return _file


def call(name, **arguments):
    """Calls the tool called name with these arguments and returns its result as text."""
    f = _connection()
    message = {"id": next(_ids), "token": _os.environ["LLAMARUN_TOOLS_TOKEN"], "name": name, "arguments": arguments}
    f.write((_json.dumps(message) + "\\n").encode("utf-8"))
    f.flush()
    line = f.readline()
    if not line:
        raise ToolError("Llama Run closed the connection")
    reply = _json.loads(line)
    if reply.get("error"):
        raise ToolError(reply["error"])
    return reply.get("text", "")


def _tool(name):
    def run(**arguments):
        return call(name, **arguments)

    run.__name__ = name
    return run


${defs.join('\n')}
TOOLS = ${JSON.stringify(names.filter((n) => n !== RUN_CODE))}
`
}

/** Output for the model: all of it when short, otherwise the start and the end. */
export function clip(text: string): string {
  if (text.length <= OUTPUT_HEAD + OUTPUT_TAIL) return text
  return `${text.slice(0, OUTPUT_HEAD)}\n…[${text.length - OUTPUT_HEAD - OUTPUT_TAIL} characters left out]…\n${text.slice(-OUTPUT_TAIL)}`
}

export interface CodeContext {
  chatId?: string
}

/** Runs the model's script; `tools` are the chat's tools it may call (run_code itself excluded). */
export async function runCode(args: Record<string, unknown>, tools: ToolBridge, context: CodeContext): Promise<McpToolResult> {
  const code = typeof args.code === 'string' ? args.code : ''
  if (!code.trim()) throw new Error('"code" is required')
  const timeout = Math.max(5, Math.min(MAX_TIMEOUT_S, Math.floor(Number(args.timeout) || DEFAULT_TIMEOUT_S)))
  if (!(context.chatId && allowedChats.has(context.chatId))) {
    const answer = await askApproval(context.chatId, {
      title: 'Run this Python code?',
      command: code,
      detail: `In ${skillWorkspace()}. It can call Llama Run's tools; any that ask before acting still ask.`,
      alwaysLabel: 'Allow code for this chat'
    })
    if (answer === 'deny') throw new Error('The user denied this code. Ask them how to continue.')
    if (answer === 'always' && context.chatId) allowedChats.add(context.chatId)
  }

  const names = tools.tools.map((t) => t.name).filter((n) => n !== RUN_CODE)
  const byPython = new Map(names.map((n) => [n, n]))
  const dir = join(skillWorkspace(), '.llamarun-code', randomUUID())
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'llamarun_tools.py'), toolsModule(names), 'utf8')
  const script = join(dir, 'script.py')
  writeFileSync(script, code, 'utf8')

  const token = randomBytes(24).toString('hex')
  let calls = 0
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    const lines = createInterface({ input: socket })
    // One call at a time per connection, in order: the script waits for each answer.
    let queue = Promise.resolve()
    lines.on('line', (line) => {
      queue = queue.then(async () => {
        let id: unknown = null
        try {
          const message = JSON.parse(line) as { id?: unknown; token?: string; name?: string; arguments?: Record<string, unknown> }
          id = message.id ?? null
          if (message.token !== token) {
            socket.destroy()
            return
          }
          const name = byPython.get(String(message.name ?? ''))
          if (!name) throw new Error(`No tool called ${String(message.name)}. Tools: ${names.join(', ')}`)
          if (++calls > MAX_TOOL_CALLS) throw new Error(`This script already made ${MAX_TOOL_CALLS} tool calls, the most one script may make.`)
          const result = await tools.call(name, message.arguments ?? {})
          // A failure arrives as ToolError, so the text needs no "Tool error:" in front.
          const text = toolResultToText({ ...result, isError: false }, MAX_RESULT_CHARS)
          socket.write(`${JSON.stringify(result.isError ? { id, error: text } : { id, text })}\n`)
        } catch (err) {
          socket.write(`${JSON.stringify({ id, error: (err as Error).message })}\n`)
        }
      })
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as AddressInfo).port

  try {
    const { stdout, stderr, exitCode, timedOut } = await new Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }>((done, fail) => {
      const proc = spawn(pythonExecutable(), ['-X', 'utf8', script], {
        cwd: skillWorkspace(),
        windowsHide: true,
        env: { ...commandEnv(), PYTHONPATH: dir, LLAMARUN_TOOLS_PORT: String(port), LLAMARUN_TOOLS_TOKEN: token, PYTHONUNBUFFERED: '1' }
      })
      let out = ''
      let err = ''
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        proc.kill()
      }, timeout * 1000)
      proc.stdout.on('data', (d) => (out += d))
      proc.stderr.on('data', (d) => (err += d))
      proc.on('error', (e) => {
        clearTimeout(timer)
        fail(e)
      })
      proc.on('close', (code) => {
        clearTimeout(timer)
        done({ stdout: out, stderr: err, exitCode: code, timedOut })
      })
      proc.stdin.end()
    })
    const parts = [
      timedOut ? `Stopped after ${timeout} seconds.` : `exit code: ${exitCode}`,
      stdout.trim() ? clip(stdout.trim()) : '(nothing printed)',
      stderr.trim() && (exitCode !== 0 || timedOut) ? `stderr:\n${clip(stderr.trim())}` : '',
      calls ? `(${calls} tool call${calls === 1 ? '' : 's'})` : ''
    ].filter(Boolean)
    return { content: [{ type: 'text', text: parts.join('\n') }], isError: timedOut || exitCode !== 0 }
  } finally {
    for (const socket of sockets) socket.destroy()
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HookConfig, HookEvent, HookHandler } from '@shared/types'
import { readJson, writeJson } from '../jsonFile'
import type { BuiltinHooks } from '../plugins/host'
import { userDataPath } from '../paths'

/**
 * The user's own commands at points in a chat's life, like Claude Code's and
 * Codex's hooks, in Claude Code's format so existing hooks work as they are:
 * userData/hooks.json is {"hooks": {"PreToolUse": [{"matcher": "Bash|Write",
 * "hooks": [{"type": "command", "command": "...", "timeout": 60}]}], ...}}.
 * A hook gets the event as JSON on stdin. Exit code 2 blocks (a tool call, a
 * prompt, or the reply stopping) with stderr as the reason; stdout, or a JSON
 * reply's additionalContext, adds context. The user wrote them, so they run
 * without approval, with the same environment as commands.
 */

export const HOOK_EVENTS: HookEvent[] = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
const DEFAULT_TIMEOUT_S = 60
const MAX_OUTPUT = 10_000

/** Claude Code's names for Llama Run's tools, so its matchers ("Bash", "Write|Edit") match. */
const CLAUDE_NAMES: Record<string, string> = {
  run_command: 'Bash',
  process_output: 'BashOutput',
  process_stop: 'KillShell',
  write_file: 'Write',
  edit_file: 'Edit',
  read_file: 'Read',
  file_glob: 'Glob',
  file_grep: 'Grep',
  file_list: 'LS',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  agent_run: 'Task',
  todo_update: 'TodoWrite'
}

export const hooksPath = (): string => userDataPath('hooks.json')

export function loadHooks(): HookConfig {
  const data = readJson<{ hooks?: HookConfig }>(hooksPath(), {})
  return data.hooks && typeof data.hooks === 'object' ? data.hooks : {}
}

/** Checks the shape and saves; throws with what is wrong. */
export function saveHooks(config: unknown): HookConfig {
  const hooks = validateHooks(config)
  writeJson(hooksPath(), { hooks })
  return hooks
}

export function validateHooks(config: unknown): HookConfig {
  const root = (config && typeof config === 'object' && 'hooks' in (config as object) ? (config as { hooks: unknown }).hooks : config) as Record<string, unknown>
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('Hooks must be an object of events, e.g. {"PreToolUse": [...]}')
  const out: HookConfig = {}
  for (const [event, groups] of Object.entries(root)) {
    if (!HOOK_EVENTS.includes(event as HookEvent)) throw new Error(`Unknown hook event "${event}". Llama Run runs: ${HOOK_EVENTS.join(', ')}.`)
    if (!Array.isArray(groups)) throw new Error(`${event} must be a list`)
    out[event as HookEvent] = groups.map((g, i) => {
      const group = g as { matcher?: unknown; hooks?: unknown }
      if (!Array.isArray(group.hooks)) throw new Error(`${event}[${i}] needs a "hooks" list`)
      if (group.matcher !== undefined && typeof group.matcher !== 'string') throw new Error(`${event}[${i}].matcher must be text`)
      if (typeof group.matcher === 'string' && group.matcher && group.matcher !== '*') {
        try {
          new RegExp(group.matcher)
        } catch {
          throw new Error(`${event}[${i}].matcher is not a valid pattern`)
        }
      }
      const handlers: HookHandler[] = group.hooks.map((h, j) => {
        const hook = h as Partial<HookHandler>
        if (hook.type !== 'command' || typeof hook.command !== 'string' || !hook.command.trim()) throw new Error(`${event}[${i}].hooks[${j}] needs "type": "command" and a "command"`)
        return { type: 'command', command: hook.command, ...(typeof hook.timeout === 'number' && hook.timeout > 0 ? { timeout: Math.min(600, hook.timeout) } : {}) }
      })
      return { ...(typeof group.matcher === 'string' && group.matcher ? { matcher: group.matcher } : {}), hooks: handlers }
    })
  }
  return out
}

/** Claude Code's own hooks (~/.claude/settings.json), for Settings' Import button. */
export function claudeCodeHooks(): HookConfig | null {
  const file = join(homedir(), '.claude', 'settings.json')
  if (!existsSync(file)) return null
  const data = readJson<{ hooks?: unknown }>(file, {})
  if (!data.hooks) return null
  try {
    return validateHooks(data.hooks)
  } catch {
    return null
  }
}

function matches(matcher: string | undefined, tool: string | undefined): boolean {
  if (!matcher || matcher === '*' || tool === undefined) return true
  const names = [tool, CLAUDE_NAMES[tool]].filter(Boolean) as string[]
  try {
    const re = new RegExp(`^(?:${matcher})$`)
    return names.some((n) => re.test(n))
  } catch {
    return false
  }
}

/** The tool's arguments, with Claude Code's field names alongside (command, file_path), so its hooks read them. */
function toolInput(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  if (typeof args.path === 'string') extra.file_path = args.path
  if (name === 'agent_run' && typeof args.task === 'string') extra.prompt = args.task
  return { ...args, ...extra }
}

export interface HookInput {
  chatId: string
  cwd: string
  prompt?: string
  tool?: string
  args?: Record<string, unknown>
  result?: string
  /** Stop: this reply already continued because of a Stop hook. */
  stopActive?: boolean
  source?: 'startup' | 'resume'
}

export interface HookOutcome {
  /** A hook asked to block (exit code 2, or decision "block" / permissionDecision "deny"). */
  blocked: boolean
  /** Why, for the model or the user. */
  reason: string
  /** Context to add (stdout of a successful hook, or additionalContext). */
  context: string
}

export type HookRunner = (command: string, stdin: string, cwd: string, timeoutS: number, env: NodeJS.ProcessEnv) => Promise<{ code: number | null; stdout: string; stderr: string }>

const defaultRunner: HookRunner = (command, stdin, cwd, timeoutS, env) =>
  new Promise((done) => {
    const [shell, args] =
      process.platform === 'win32'
        ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]]
        : ['/bin/sh', ['-c', command]]
    let stdout = ''
    let stderr = ''
    let proc
    try {
      proc = spawn(shell, args as string[], { cwd: existsSync(cwd) ? cwd : undefined, env, windowsHide: true })
    } catch (err) {
      done({ code: null, stdout: '', stderr: (err as Error).message })
      return
    }
    const timer = setTimeout(() => proc.kill(), timeoutS * 1000)
    proc.stdout.on('data', (d) => (stdout += d))
    proc.stderr.on('data', (d) => (stderr += d))
    proc.on('error', (e) => {
      clearTimeout(timer)
      done({ code: null, stdout, stderr: stderr || e.message })
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr })
    })
    proc.stdin.end(stdin)
  })

let runner: HookRunner = defaultRunner
/** Tests swap how commands run. */
export function setHookRunner(next: HookRunner | null): void {
  runner = next ?? defaultRunner
}

const EVENT_FIELDS: Record<HookEvent, (i: HookInput) => Record<string, unknown>> = {
  SessionStart: (i) => ({ source: i.source ?? 'startup' }),
  UserPromptSubmit: (i) => ({ prompt: i.prompt ?? '' }),
  PreToolUse: (i) => ({ tool_name: i.tool, tool_input: toolInput(i.tool ?? '', i.args ?? {}) }),
  PostToolUse: (i) => ({ tool_name: i.tool, tool_input: toolInput(i.tool ?? '', i.args ?? {}), tool_response: i.result ?? '' }),
  Stop: (i) => ({ stop_hook_active: Boolean(i.stopActive) })
}

/**
 * Runs the hooks for an event (those whose matcher fits the tool), all at once,
 * and combines what they said. No hooks: nothing blocked, no context.
 */
export async function runHooks(event: HookEvent, input: HookInput, env: NodeJS.ProcessEnv, config: HookConfig = loadHooks()): Promise<HookOutcome> {
  const handlers = (config[event] ?? []).filter((g) => matches(g.matcher, input.tool)).flatMap((g) => g.hooks)
  if (!handlers.length) return { blocked: false, reason: '', context: '' }
  const stdin = JSON.stringify({ session_id: input.chatId, cwd: input.cwd, hook_event_name: event, ...EVENT_FIELDS[event](input) })
  const hookEnv = { ...env, CLAUDE_PROJECT_DIR: input.cwd, LLAMARUN_CHAT_ID: input.chatId, LLAMARUN_HOOK_EVENT: event }
  const results = await Promise.all(handlers.map((h) => runner(h.command, stdin, input.cwd, h.timeout ?? DEFAULT_TIMEOUT_S, hookEnv)))
  const outcome: HookOutcome = { blocked: false, reason: '', context: '' }
  const reasons: string[] = []
  const context: string[] = []
  for (const { code, stdout, stderr } of results) {
    const out = stdout.trim().slice(0, MAX_OUTPUT)
    let json: Record<string, unknown> | null = null
    if (out.startsWith('{')) {
      try {
        json = JSON.parse(out) as Record<string, unknown>
      } catch {
        json = null
      }
    }
    const specific = (json?.hookSpecificOutput ?? {}) as Record<string, unknown>
    const denied = json?.decision === 'block' || specific.permissionDecision === 'deny' || json?.continue === false
    if (code === 2 || denied) {
      outcome.blocked = true
      reasons.push(String(json?.reason ?? specific.permissionDecisionReason ?? json?.stopReason ?? stderr.trim() ?? '').slice(0, MAX_OUTPUT) || 'A hook blocked this.')
      continue
    }
    if (code === 0) {
      const extra = typeof specific.additionalContext === 'string' ? specific.additionalContext : json ? '' : out
      if (extra.trim()) context.push(extra.trim())
    }
    // Other exit codes are the hook's own failure: it doesn't block, as in Claude Code.
  }
  outcome.reason = reasons.join('\n')
  outcome.context = context.join('\n\n')
  return outcome
}

/**
 * hooks.json as a built-in handler on the plugin events, so the user's hooks
 * and plugins' hooks run from one place: UserPromptSubmit on
 * before_text_generation, SessionStart on session_start, PreToolUse and
 * PostToolUse on before / after_tool_call, Stop on stop.
 */
export function createCommandHooks(env: () => NodeJS.ProcessEnv): BuiltinHooks {
  const has = (event: HookEvent): boolean => Boolean(loadHooks()[event]?.length)
  return {
    label: 'your hooks',
    watches: (event) =>
      event === 'prompt' ? has('UserPromptSubmit') : event === 'session_start' ? has('SessionStart') : event === 'stop' ? has('Stop') : has('PreToolUse') || has('PostToolUse'),
    onPrompt: (scope, prompt) => runHooks('UserPromptSubmit', { ...scope, prompt }, env()),
    onSessionStart: async (scope) => (await runHooks('SessionStart', scope, env())).context,
    onBeforeToolCall: (scope, tool, args) => runHooks('PreToolUse', { ...scope, tool, args }, env()),
    onAfterToolCall: async (scope, tool, args, result) => {
      const post = await runHooks('PostToolUse', { ...scope, tool, args, result }, env())
      return [post.blocked ? `A hook objected: ${post.reason}` : '', post.context].filter(Boolean).join('\n')
    },
    onStop: async (scope, again) => {
      const out = await runHooks('Stop', { ...scope, stopActive: again }, env())
      return out.blocked ? out.reason : null
    }
  }
}

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HookConfig } from '../src/shared/types'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-hooks-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.' } }))
const { createCommandHooks, loadHooks, runHooks, saveHooks, setHookRunner, validateHooks } = await import('../src/main/assistant/hooks')

afterEach(() => setHookRunner(null))

const config: HookConfig = {
  PreToolUse: [
    { matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] },
    { matcher: 'write_file', hooks: [{ type: 'command', command: 'lint' }] }
  ],
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ctx' }] }]
}

describe('hooks', () => {
  it("matches Claude Code's tool names and passes its fields on stdin", async () => {
    const seen: { command: string; stdin: Record<string, unknown> }[] = []
    setHookRunner(async (command, stdin) => {
      seen.push({ command, stdin: JSON.parse(stdin) })
      return { code: 0, stdout: '', stderr: '' }
    })
    await runHooks('PreToolUse', { chatId: 'c1', cwd: 'D:\\proj', tool: 'run_command', args: { command: 'rm -rf x' } }, {}, config)
    expect(seen.map((s) => s.command)).toEqual(['guard'])
    expect(seen[0].stdin).toMatchObject({ session_id: 'c1', cwd: 'D:\\proj', hook_event_name: 'PreToolUse', tool_name: 'run_command', tool_input: { command: 'rm -rf x' } })
    seen.length = 0
    await runHooks('PreToolUse', { chatId: 'c1', cwd: '.', tool: 'write_file', args: { path: 'a.ts' } }, {}, config)
    expect(seen[0].stdin.tool_input).toEqual({ path: 'a.ts', file_path: 'a.ts' })
    seen.length = 0
    await runHooks('PreToolUse', { chatId: 'c1', cwd: '.', tool: 'read_file', args: {} }, {}, config)
    expect(seen).toHaveLength(0)
  })

  it('blocks on exit code 2 or a JSON decision, and adds context from stdout', async () => {
    setHookRunner(async () => ({ code: 2, stdout: '', stderr: 'No deleting outside the project' }))
    expect(await runHooks('PreToolUse', { chatId: 'c', cwd: '.', tool: 'run_command', args: {} }, {}, config)).toEqual({ blocked: true, reason: 'No deleting outside the project', context: '' })
    setHookRunner(async () => ({ code: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'not today' } }), stderr: '' }))
    expect((await runHooks('PreToolUse', { chatId: 'c', cwd: '.', tool: 'run_command', args: {} }, {}, config)).reason).toBe('not today')
    setHookRunner(async () => ({ code: 0, stdout: 'Current branch: main', stderr: '' }))
    expect(await runHooks('UserPromptSubmit', { chatId: 'c', cwd: '.', prompt: 'hi' }, {}, config)).toEqual({ blocked: false, reason: '', context: 'Current branch: main' })
    // A hook that fails on its own (exit 1) doesn't block.
    setHookRunner(async () => ({ code: 1, stdout: 'oops', stderr: 'broken' }))
    expect((await runHooks('UserPromptSubmit', { chatId: 'c', cwd: '.', prompt: 'hi' }, {}, config)).blocked).toBe(false)
  })

  it('validates and saves in Claude Code format', () => {
    expect(() => validateHooks({ Notification: [] })).toThrow('Unknown hook event')
    expect(() => validateHooks({ Stop: [{ hooks: [{ type: 'command' }] }] })).toThrow('needs "type": "command"')
    saveHooks({ hooks: config })
    expect(loadHooks()).toEqual(config)
  })

  it('runs hooks.json on the plugin events: prompt, session start, tool calls and stop', async () => {
    saveHooks({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'prompt' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: 'start' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }],
        PostToolUse: [{ hooks: [{ type: 'command', command: 'fmt' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'stop' }] }]
      }
    })
    const replies: Record<string, { code: number; stdout: string; stderr: string }> = {
      prompt: { code: 0, stdout: 'branch: main', stderr: '' },
      start: { code: 0, stdout: 'hello', stderr: '' },
      guard: { code: 2, stdout: '', stderr: 'not here' },
      fmt: { code: 0, stdout: 'formatted', stderr: '' },
      stop: { code: 2, stdout: '', stderr: 'tests fail' }
    }
    setHookRunner(async (command) => replies[command])
    const hooks = createCommandHooks(() => ({}))
    const scope = { chatId: 'c', cwd: '.' }
    expect(['prompt', 'session_start', 'tool', 'stop'].every((e) => hooks.watches(e as 'tool'))).toBe(true)
    expect(await hooks.onPrompt(scope, 'hi')).toMatchObject({ blocked: false, context: 'branch: main' })
    expect(await hooks.onSessionStart(scope)).toBe('hello')
    expect(await hooks.onBeforeToolCall(scope, 'run_command', { command: 'x' })).toMatchObject({ blocked: true, reason: 'not here' })
    expect(await hooks.onAfterToolCall(scope, 'write_file', { path: 'a' }, 'ok', false)).toBe('formatted')
    expect(await hooks.onStop(scope, false)).toBe('tests fail')
    saveHooks({ hooks: {} })
    expect(hooks.watches('tool')).toBe(false)
  })

  it.runIf(process.platform === 'win32')('runs a real PowerShell hook: exit 2 with stderr blocks', async () => {
    const real: HookConfig = { Stop: [{ hooks: [{ type: 'command', command: "[Console]::Error.WriteLine('keep going'); exit 2" }] }] }
    const outcome = await runHooks('Stop', { chatId: 'c', cwd: userData }, process.env, real)
    expect(outcome).toEqual({ blocked: true, reason: 'keep going', context: '' })
  }, 30_000)
})

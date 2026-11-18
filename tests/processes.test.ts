import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import * as processes from '../src/main/assistant/processes'

/** A child process the test writes to and ends. */
function fakeChild(): ChildProcess & { write: (s: string) => void; exit: (code: number) => void; killed: boolean } {
  const child = new EventEmitter() as ChildProcess & { write: (s: string) => void; exit: (code: number) => void; killed: boolean }
  const stdout = new PassThrough()
  Object.assign(child, {
    stdout,
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    pid: undefined,
    killed: false,
    kill: () => {
      child.killed = true
      child.emit('close', null)
      return true
    },
    write: (s: string) => stdout.write(s),
    exit: (code: number) => child.emit('close', code)
  })
  return child
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5))
let last: ReturnType<typeof fakeChild>
processes.setSpawner(() => (last = fakeChild()))
afterEach(() => processes.stopAll())

describe('background processes', () => {
  it('returns only new output each read, and the exit code', async () => {
    const p = processes.startBackground('chat1', 'npm run dev', '.', {})
    last.write('Local: http://localhost:5173\n')
    await flush()
    expect(processes.output('chat1', p.id)).toContain('running for')
    expect(processes.output('chat1', p.id)).toContain('(no new output)')
    last.write('compiled\n')
    last.exit(0)
    await flush()
    const out = processes.output('chat1', p.id)
    expect(out).toContain('exited with code 0')
    expect(out).toContain('compiled')
    expect(out).not.toContain('localhost')
    expect(processes.output('chat1', p.id, true)).toContain('localhost')
  })

  it('belongs to its chat', () => {
    const p = processes.startBackground('chat1', 'serve', '.', {})
    expect(() => processes.output('chat2', p.id)).toThrow('No background command')
    expect(processes.list('chat1')).toContain(p.id)
    expect(processes.list('chat2')).toBe('No background commands in this chat.')
  })

  it('stops one, and all of a deleted chat', () => {
    const a = processes.startBackground('chat1', 'a', '.', {})
    const first = last
    processes.startBackground('chat1', 'b', '.', {})
    const second = last
    expect(processes.stop('chat1', a.id)).toContain('Stopped')
    expect(first.killed).toBe(true)
    processes.stopChat('chat1')
    expect(second.killed).toBe(true)
    expect(processes.list('chat1')).toBe('No background commands in this chat.')
  })

  it('caps how many run per chat', () => {
    for (let i = 0; i < processes.MAX_PER_CHAT; i++) processes.startBackground('chat3', `job ${i}`, '.', {})
    expect(() => processes.startBackground('chat3', 'one more', '.', {})).toThrow('already has')
  })
})

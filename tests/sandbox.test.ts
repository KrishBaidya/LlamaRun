import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-sbx-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.' } }))
const { encodeCommand, spawnSandboxed } = await import('../src/main/assistant/sandbox')

const run = (command: string, cwd: string, writable: string[]): Promise<{ code: number | null; out: string }> =>
  new Promise((done) => {
    const p = spawnSandboxed(command, cwd, process.env, writable)
    let out = ''
    p.stdout?.on('data', (d) => (out += d))
    p.stderr?.on('data', (d) => (out += d))
    p.on('close', (code) => done({ code, out }))
  })

describe('command sandbox', () => {
  it('encodes commands for -EncodedCommand', () => {
    expect(Buffer.from(encodeCommand('echo "a & b" | x'), 'base64').toString('utf16le')).toBe('echo "a & b" | x')
  })

  it.runIf(process.platform === 'win32')('writes in allowed folders only, and keeps working otherwise', async () => {
    const allowed = join(userData, 'project')
    const other = join(userData, 'elsewhere')
    mkdirSync(allowed)
    mkdirSync(other)
    const { out } = await run(
      `Set-Content -Path '${join(allowed, 'ok.txt')}' -Value 1; try { Set-Content -Path '${join(other, 'bad.txt')}' -Value 1 -ErrorAction Stop; 'WROTE' } catch { 'DENIED' }; "sum=$(2+2)"`,
      allowed,
      [allowed]
    )
    expect(existsSync(join(allowed, 'ok.txt'))).toBe(true)
    expect(existsSync(join(other, 'bad.txt'))).toBe(false)
    expect(out).toContain('DENIED')
    expect(out).toContain('sum=4')
  }, 60_000)
})

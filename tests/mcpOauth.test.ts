import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-mcp-oauth-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.' },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(`enc:${s}`), decryptString: (b: Buffer) => b.toString().slice(4) },
  shell: { openExternal: vi.fn() }
}))
const { McpOAuthProvider, forgetSignIn } = await import('../src/main/mcp/oauth')

describe('MCP sign-in', () => {
  it('opens the sign-in page and catches the code on the loopback address', async () => {
    const opened: string[] = []
    const auth = new McpOAuthProvider('Linear', true, async (url) => {
      opened.push(url)
      // The browser comes back with the code.
      void fetch(`${auth.redirectUrl}?code=abc&state=${auth.state()}`)
    })
    await auth.redirectToAuthorization(new URL('https://example.com/authorize?x=1'))
    expect(opened).toEqual(['https://example.com/authorize?x=1'])
    expect(await auth.code).toBe('abc')
  })

  it("doesn't open the browser on its own at startup", async () => {
    const open = vi.fn()
    const auth = new McpOAuthProvider('Notion', false, open)
    await auth.redirectToAuthorization(new URL('https://example.com/authorize'))
    expect(open).not.toHaveBeenCalled()
    expect(auth.signInStarted).toBe(true)
    expect(auth.code).toBeNull()
  })

  it('keeps tokens per server, encrypted, and forgets them', () => {
    const auth = new McpOAuthProvider('GitHub', false)
    auth.saveTokens({ access_token: 'secret-token', token_type: 'Bearer' })
    expect(new McpOAuthProvider('GitHub', false).tokens()?.access_token).toBe('secret-token')
    expect(readFileSync(join(userData, 'mcp-auth.json'), 'utf8')).not.toContain('secret-token')
    forgetSignIn('GitHub')
    expect(new McpOAuthProvider('GitHub', false).tokens()).toBeUndefined()
  })
})

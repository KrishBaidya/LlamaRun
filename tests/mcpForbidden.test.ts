import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-mcp403-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.' },
  shell: { openExternal: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false }
}))

/** A server like Adobe's: 403 with an empty body to anyone not signed in, and OAuth metadata at the root. */
let withMetadata = true
const server: Server = createServer((req, res) => {
  if (req.url?.startsWith('/.well-known/oauth-protected-resource') && withMetadata && req.url === '/.well-known/oauth-protected-resource') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ resource: 'http://127.0.0.1', authorization_servers: ['https://auth.example.com'] }))
    return
  }
  res.writeHead(req.url?.startsWith('/.well-known') ? 404 : 403).end()
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
writeFileSync(join(userData, 'mcp.json'), JSON.stringify([{ name: 'Adobe-like', mcpType: 'SSE', data: { Command: null, Arguments: [], EnvironmentVariables: {}, URL: `${base}/mcp` } }]))

const { mcp, protectedResourceMetadata } = await import('../src/main/mcp/manager')
afterAll(async () => {
  await mcp.stop()
  server.close()
})

describe('a server that answers 403 instead of 401', () => {
  it('finds its OAuth metadata (path first, then root)', async () => {
    expect((await protectedResourceMetadata(new URL(`${base}/mcp`)))?.toString()).toBe(`${base}/.well-known/oauth-protected-resource`)
  })

  it('asks the user to sign in instead of failing', async () => {
    await mcp.start()
    expect(mcp.statuses()[0]).toMatchObject({ state: 'signin', error: 'Sign in to use this server.' })
  }, 20_000)

  it('still fails plainly when the server has no sign-in', async () => {
    withMetadata = false
    await mcp.start()
    expect(mcp.statuses()[0].state).toBe('error')
    withMetadata = true
  }, 20_000)
})

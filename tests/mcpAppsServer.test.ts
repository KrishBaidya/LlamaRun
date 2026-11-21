import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-mcpapps-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.' }, shell: {}, safeStorage: { isEncryptionAvailable: () => false } }))
writeFileSync(
  join(userData, 'mcp.json'),
  JSON.stringify([{ name: 'weather', mcpType: 'STDIO', data: { Command: process.execPath, Arguments: [resolve('tests/fixtures/mcpAppServer.mjs')], EnvironmentVariables: {} } }])
)
const { mcp } = await import('../src/main/mcp/manager')
afterAll(() => mcp.stop())

describe('MCP Apps against a real server', () => {
  it('says it shows apps, hides app-only tools from the model, and returns the app with the result', async () => {
    await mcp.start()
    expect(mcp.statuses()[0]).toMatchObject({ state: 'connected' })
    expect(mcp.tools().map((t) => t.name)).toEqual(['get_weather', 'model_only'])
    const result = await mcp.callTool('get_weather', { city: 'Pune' })
    expect(JSON.stringify(result.content)).toContain('ui true')
    expect(result.app).toMatchObject({ server: 'weather', uri: 'ui://weather/dash', tool: 'get_weather', args: { city: 'Pune' }, result: { structuredContent: { temp: 31, city: 'Pune' } } })
    expect((await mcp.callTool('model_only', {})).app).toBeUndefined()
  }, 30_000)

  it("gives the app its page and policy, and only its own server's app tools", async () => {
    const page = await mcp.appResource('weather', 'ui://weather/dash')
    expect(page).toEqual({ html: expect.stringContaining('Weather'), csp: { connectDomains: ['https://api.weather.com'] }, permissions: ['clipboardWrite'], prefersBorder: false })
    expect(JSON.stringify((await mcp.appCallTool('weather', 'refresh_weather', {})).content)).toContain('refresh_weather')
    await expect(mcp.appCallTool('weather', 'model_only', {})).rejects.toThrow('not available to apps')
    await expect(mcp.appResource('weather', 'https://evil')).rejects.toThrow('Not an MCP App')
  }, 30_000)
})

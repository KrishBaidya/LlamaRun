import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.' } }))

const { configFromDirectoryEntry, isServerConfig } = await import('../src/main/mcp/config')

describe('configFromDirectoryEntry', () => {
  it('converts the directory {mcpServer} shape', () => {
    const cfg = configFromDirectoryEntry('fs', {
      mcpServer: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/'], env: { A: 1 } }
    })
    expect(cfg).toEqual({
      name: 'fs',
      mcpType: 'STDIO',
      data: {
        Command: 'npx',
        Arguments: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/'],
        EnvironmentVariables: { A: '1' },
        URL: null
      }
    })
    expect(isServerConfig(cfg)).toBe(true)
  })

  it('accepts JSON strings and the {mcpServers} shape, detecting URL servers', () => {
    const cfg = configFromDirectoryEntry('remote', JSON.stringify({ mcpServers: { x: { url: 'https://e.com/mcp' } } }))
    expect(cfg.mcpType).toBe('SSE')
    expect(cfg.data.URL).toBe('https://e.com/mcp')
  })

  it('rejects malformed entries', () => {
    expect(isServerConfig({ name: '', mcpType: 'STDIO', data: {} })).toBe(false)
    expect(isServerConfig({ name: 'x', mcpType: 'HTTP', data: {} })).toBe(false)
  })
})

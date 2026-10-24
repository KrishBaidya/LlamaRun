import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  globalShortcut: {},
  Notification: class {},
  safeStorage: {},
  shell: {}
}))

const { chatTools } = await import('../src/main/chats/service')
const { mcp } = await import('../src/main/mcp/manager')
const { pluginHost } = await import('../src/main/plugins/host')

const tool = (name: string, server: string) => ({ name, server, description: '', inputSchema: {} })

describe('chatTools', () => {
  it('offers MCP and plugin tools together and calls each where it lives', async () => {
    vi.spyOn(mcp, 'tools').mockReturnValue([tool('search', 'github')])
    const modelTools = vi.spyOn(pluginHost, 'modelTools').mockReturnValue([tool('create_plugin', 'Plugin Creator')])
    const callMcp = vi.spyOn(mcp, 'callTool').mockResolvedValue({ content: [{ type: 'text', text: 'mcp' }] })
    const callPlugin = vi.spyOn(pluginHost, 'callModelTool').mockResolvedValue({ content: [{ type: 'text', text: 'plugin' }] })

    const bridge = chatTools()!
    expect(bridge.tools.map((t) => t.name)).toEqual(['search', 'create_plugin'])
    // Plugins can't take a name an MCP server already uses.
    expect(modelTools).toHaveBeenCalledWith(new Set(['search']))
    await bridge.call('search', { q: 1 })
    await bridge.call('create_plugin', { name: 'x' })
    expect(callMcp).toHaveBeenCalledWith('search', { q: 1 })
    expect(callPlugin).toHaveBeenCalledWith('create_plugin', { name: 'x' })
    vi.restoreAllMocks()
  })

  it('offers nothing when there are no tools', () => {
    vi.spyOn(mcp, 'tools').mockReturnValue([])
    vi.spyOn(pluginHost, 'modelTools').mockReturnValue([])
    expect(chatTools()).toBeUndefined()
    vi.restoreAllMocks()
  })
})

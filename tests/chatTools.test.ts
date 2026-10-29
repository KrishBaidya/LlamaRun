import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  globalShortcut: {},
  Notification: class {},
  safeStorage: {},
  shell: {}
}))

// Llama Run's own tools (memory, skills) are tested on their own below; here they're off unless a test turns them on.
const ownTools = vi.hoisted(() => ({ list: [] as { name: string; server: string; description: string; inputSchema: object }[] }))
vi.mock('../src/main/assistant/builtins', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/assistant/builtins')>()
  return {
    ...real,
    builtinTools: () => ownTools.list,
    isBuiltinTool: (name: string) => ownTools.list.some((t) => t.name === name),
    callBuiltinTool: async (name: string) => ({ content: [{ type: 'text', text: `own ${name}` }] })
  }
})

const { chatTools, computerFor } = await import('../src/main/chats/service')
const { computer } = await import('../src/main/computer/tools')
const { settings } = await import('../src/main/settings')
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

  it("puts Llama Run's own tools first, keeps their names, and calls them itself", async () => {
    ownTools.list = [tool('memory_save', 'Llama Run')]
    vi.spyOn(mcp, 'tools').mockReturnValue([tool('memory_save', 'rogue'), tool('search', 'github')])
    const modelTools = vi.spyOn(pluginHost, 'modelTools').mockReturnValue([])
    const callMcp = vi.spyOn(mcp, 'callTool')

    const bridge = chatTools()!
    expect(bridge.tools.map((t) => `${t.server}:${t.name}`)).toEqual(['Llama Run:memory_save', 'github:search'])
    expect(modelTools).toHaveBeenCalledWith(new Set(['memory_save', 'search']))
    expect(await bridge.call('memory_save', { text: 'x' })).toEqual({ content: [{ type: 'text', text: 'own memory_save' }] })
    expect(callMcp).not.toHaveBeenCalled()
    ownTools.list = []
    vi.restoreAllMocks()
  })

  it('offers computer use only when asked, ahead of a same-named MCP tool, and calls it itself', async () => {
    vi.spyOn(mcp, 'tools').mockReturnValue([tool('computer_click', 'rogue'), tool('search', 'github')])
    vi.spyOn(pluginHost, 'modelTools').mockReturnValue([])
    const callMcp = vi.spyOn(mcp, 'callTool')
    const callComputer = vi.spyOn(computer, 'call').mockResolvedValue({ content: [{ type: 'text', text: 'clicked' }] })

    expect(chatTools()!.tools.some((t) => t.server === 'Computer use')).toBe(false)
    const bridge = chatTools({ chatId: 'c1', computer: { screenshots: true } })!
    expect(bridge.tools.filter((t) => t.name === 'computer_click').map((t) => t.server)).toEqual(['Computer use'])
    await bridge.call('computer_click', { window: 1, element: 2 })
    expect(callComputer).toHaveBeenCalledWith('computer_click', { window: 1, element: 2 }, { chatId: 'c1', screenshots: true })
    expect(callMcp).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('gives computer use to typed turns only, with screenshots for local vision models', () => {
    const on: Record<string, unknown> = { computerUse: true, computerScreenshots: true }
    vi.spyOn(settings, 'get').mockImplementation(((key: string) => on[key]) as typeof settings.get)
    const local = { id: 'qwen', name: 'Qwen', provider: 'ollama', cloud: false, capabilities: ['tools', 'vision'] } as const
    const cloud = { ...local, provider: 'gemini', cloud: true } as const
    expect(computerFor(true, { ...local, capabilities: [...local.capabilities] })).toEqual({ screenshots: true })
    expect(computerFor(true, { ...cloud, capabilities: [...cloud.capabilities] })).toEqual({ screenshots: false })
    expect(computerFor(true, { ...local, capabilities: ['tools'] })).toEqual({ screenshots: false })
    expect(computerFor(false, undefined)).toBeUndefined()
    expect(computerFor(true, undefined, { tools: false })).toBeUndefined()
    on.computerUse = false
    expect(computerFor(true, undefined)).toBeUndefined()
    vi.restoreAllMocks()
  })

  it('offers nothing when there are no tools', () => {
    vi.spyOn(mcp, 'tools').mockReturnValue([])
    vi.spyOn(pluginHost, 'modelTools').mockReturnValue([])
    expect(chatTools()).toBeUndefined()
    vi.restoreAllMocks()
  })
})

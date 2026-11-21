import { describe, expect, it, vi } from 'vitest'
import { appCsp, cleanCsp, contextText, toolUiMeta } from '../src/shared/mcpApps'
import { McpAppBridge, type BridgeDeps } from '../src/shared/mcpAppBridge'
import type { McpAppRef } from '../src/shared/types'

describe('MCP Apps metadata and CSP', () => {
  it("reads a tool's ui resource and visibility, the deprecated flat key too", () => {
    expect(toolUiMeta({ ui: { resourceUri: 'ui://w/dash', visibility: ['app'] } })).toEqual({ resourceUri: 'ui://w/dash', visibility: ['app'] })
    expect(toolUiMeta({ 'ui/resourceUri': 'ui://w/old' })).toEqual({ resourceUri: 'ui://w/old', visibility: ['model', 'app'] })
    expect(toolUiMeta({ ui: { resourceUri: 'https://not-ui' } })).toEqual({ visibility: ['model', 'app'] })
    expect(toolUiMeta(undefined)).toEqual({ visibility: ['model', 'app'] })
  })

  it('allows only declared origins, with the restrictive defaults otherwise', () => {
    const none = appCsp(undefined)
    expect(none).toContain("connect-src 'none'")
    expect(none).toContain("frame-src 'none'")
    expect(none).toContain("default-src 'none'")
    const csp = appCsp({ connectDomains: ['https://api.example.com'], resourceDomains: ['https://*.cdn.com', "https://x.com; script-src *", 'javascript:alert(1)'] })
    expect(csp).toContain('connect-src https://api.example.com')
    expect(csp).toContain("script-src 'self' 'unsafe-inline' blob: https://*.cdn.com;")
    expect(csp).not.toContain('x.com')
    expect(cleanCsp({ frameDomains: ['https://www.youtube.com', 'bad'] })).toEqual({ frameDomains: ['https://www.youtube.com'] })
  })

  it('turns model-context updates into text', () => {
    expect(contextText({ content: [{ type: 'text', text: 'Selected: row 3' }], structuredContent: { row: 3 } })).toBe('Selected: row 3\n{"row":3}')
  })
})

describe('the host bridge', () => {
  const app: McpAppRef = { server: 'weather', uri: 'ui://weather/dash', tool: 'get_weather', args: { city: 'Pune' }, result: { content: [{ type: 'text', text: 'Sunny' }], structuredContent: { temp: 31 } } }
  let gesture = false
  const setup = (): { bridge: McpAppBridge; sent: Record<string, unknown>[]; deps: BridgeDeps } => {
    const sent: Record<string, unknown>[] = []
    const deps: BridgeDeps = {
      post: (m) => void sent.push(m),
      callTool: vi.fn(async (name: string) => ({ content: [{ type: 'text', text: `${name} ran` }] })),
      readResource: vi.fn(async () => ({ contents: [] })),
      listTools: vi.fn(async () => ({ tools: [] })),
      listResources: vi.fn(async () => ({ resources: [] })),
      close: vi.fn(),
      openLink: vi.fn(),
      message: vi.fn(),
      setContext: vi.fn(),
      requestMode: vi.fn((m) => m),
      hasGesture: () => gesture,
      resized: vi.fn()
    }
    const bridge = new McpAppBridge(app, { connectDomains: ['https://api.weather.com'] }, deps, { theme: 'dark', displayMode: 'inline', containerDimensions: { maxHeight: 600 } })
    return { bridge, sent, deps }
  }

  it('initializes, then sends the tool input and result', async () => {
    const { bridge, sent } = setup()
    await bridge.handle({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { appCapabilities: { availableDisplayModes: ['inline'] } } })
    const init = sent[0] as { id: number; result: { hostContext: { theme: string; toolInfo: { tool: { name: string } } }; hostCapabilities: { sandbox: unknown } } }
    expect(init.id).toBe(1)
    expect(init.result.hostContext).toMatchObject({ theme: 'dark', displayMode: 'inline', toolInfo: { tool: { name: 'get_weather', inputSchema: { type: 'object' } } } })
    expect(init.result.hostCapabilities.sandbox).toEqual({ csp: { connectDomains: ['https://api.weather.com'] } })
    expect(sent).toHaveLength(1) // nothing else before "initialized"
    await bridge.handle({ jsonrpc: '2.0', method: 'ui/notifications/initialized' })
    expect(sent.slice(1)).toEqual([
      { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { city: 'Pune' } } },
      { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: app.result }
    ])
  })

  it('proxies tool calls, messages, context and links; refuses unknown methods and modes the app did not list', async () => {
    const { bridge, sent, deps } = setup()
    await bridge.handle({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { appCapabilities: { availableDisplayModes: ['inline'] } } })
    await bridge.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'refresh', arguments: { city: 'Goa' } } })
    expect(deps.callTool).toHaveBeenCalledWith('refresh', { city: 'Goa' })
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'refresh ran' }] } })
    await bridge.handle({ jsonrpc: '2.0', id: 3, method: 'ui/message', params: { role: 'user', content: { type: 'text', text: 'Plan a trip there' } } })
    expect(deps.message).toHaveBeenCalledWith('Plan a trip there')
    await bridge.handle({ jsonrpc: '2.0', id: 4, method: 'ui/update-model-context', params: { content: [{ type: 'text', text: 'Viewing Goa' }] } })
    expect(deps.setContext).toHaveBeenCalledWith('Viewing Goa')
    await bridge.handle({ jsonrpc: '2.0', id: 5, method: 'ui/open-link', params: { url: 'file:///C:/x' } })
    expect((sent.at(-1) as { error: { message: string } }).error.message).toBe('Invalid URL')
    await bridge.handle({ jsonrpc: '2.0', id: 6, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } })
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 6, result: { mode: 'inline' } })
    expect(deps.requestMode).not.toHaveBeenCalled()
    await bridge.handle({ jsonrpc: '2.0', id: 7, method: 'sampling/createMessage', params: {} })
    expect((sent.at(-1) as { error: { code: number } }).error.code).toBe(-32601)
  })

  it('changes how it is shown only right after a click in the app', async () => {
    const { bridge, sent, deps } = setup()
    await bridge.handle({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] } } })
    gesture = false
    await bridge.handle({ jsonrpc: '2.0', id: 2, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } })
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 2, result: { mode: 'inline' } })
    expect(deps.requestMode).not.toHaveBeenCalled()
    gesture = true
    await bridge.handle({ jsonrpc: '2.0', id: 3, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } })
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 3, result: { mode: 'fullscreen' } })
    gesture = false
  })
})

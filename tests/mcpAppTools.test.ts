import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

vi.mock('electron', () => ({ app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.' } }))
const { appTools, appToolName } = await import('../src/main/mcp/appTools')
const { approvals } = await import('../src/main/assistant/approval')
const { McpAppBridge } = await import('../src/shared/mcpAppBridge')

/** A chat window that answers every app-tool call itself. */
function fakeWindow(reply: (call: { requestId: string; name: string; args: Record<string, unknown> }) => unknown): WebContents {
  return {
    isDestroyed: () => false,
    send: (_channel: string, call: { requestId: string; name: string; args: Record<string, unknown> }) => setTimeout(() => appTools.answer(call.requestId, reply(call)), 0)
  } as unknown as WebContents
}

describe("an open app's tools", () => {
  it('are offered to the model under app_<server>_<tool> while the app is open', () => {
    appTools.register(fakeWindow(() => ({})), 'chat-1', 'view-1', 'Canva', [{ name: 'edit-text', description: 'Change a text box', inputSchema: { type: 'object' } }, { bogus: true }])
    expect(appTools.toolsFor('chat-1')).toEqual([
      { name: 'app_canva_edit-text', server: 'Canva', description: 'In the Canva app open in this chat: Change a text box', inputSchema: { type: 'object' } }
    ])
    expect(appTools.toolsFor('other-chat')).toEqual([])
    appTools.unregister('view-1')
    expect(appTools.toolsFor('chat-1')).toEqual([])
    expect(appToolName('My Server!', 'do thing')).toBe('app_my_server_do_thing')
  })

  it('run read-only tools straight away and ask before others; a "deny" stops the call', async () => {
    const window = fakeWindow((call) => ({ content: [{ type: 'text', text: `${call.name} done with ${JSON.stringify(call.args)}` }] }))
    appTools.register(window, 'chat-2', 'view-2', 'Canva', [
      { name: 'get-selection', annotations: { readOnlyHint: true } },
      { name: 'edit-text' }
    ])
    const read = await appTools.call('chat-2', 'app_canva_get-selection', {})
    expect(read.content).toEqual([{ type: 'text', text: 'get-selection done with {}' }])

    const asked: string[] = []
    const answer = (reply: 'deny' | 'chat') => (chatId: string, request: { id: string; title: string } | null) => {
      if (chatId !== 'chat-2' || !request) return
      asked.push(request.title)
      approvals.answer(request.id, reply)
    }
    const deny = answer('deny')
    approvals.on('changed', deny)
    const denied = await appTools.call('chat-2', 'app_canva_edit-text', { text: 'Hi' })
    approvals.off('changed', deny)
    expect(denied.isError).toBe(true)
    expect(asked).toEqual(['Let the model use the Canva app?'])

    const allowChat = answer('chat')
    approvals.on('changed', allowChat)
    expect((await appTools.call('chat-2', 'app_canva_edit-text', { text: 'Hi' })).isError).toBe(false)
    approvals.off('changed', allowChat)
    // "For this chat" covers the next call without asking.
    expect((await appTools.call('chat-2', 'app_canva_edit-text', { text: 'Again' })).isError).toBe(false)
    expect(asked).toHaveLength(2)
    appTools.unregister('view-2')
    expect((await appTools.call('chat-2', 'app_canva_edit-text', {})).isError).toBe(true)
  })
})

describe('the bridge asks the app for its tools', () => {
  it('lists and calls them once the app said it has tools', async () => {
    const sent: { id?: string; method?: string; params?: unknown }[] = []
    const toolsChanged = vi.fn()
    const bridge = new McpAppBridge(
      { server: 'Canva', uri: 'ui://canva/x', tool: 'create-design', args: {} },
      {},
      { post: (m) => void sent.push(m), callTool: vi.fn(), readResource: vi.fn(), listTools: vi.fn(), listResources: vi.fn(), close: vi.fn(), openLink: vi.fn(), message: vi.fn(), setContext: vi.fn(), requestMode: (m) => m, hasGesture: () => false, resized: vi.fn(), toolsChanged },
      { theme: 'light', displayMode: 'inline', containerDimensions: {} }
    )
    await bridge.handle({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { appCapabilities: { tools: { listChanged: true } } } })
    await bridge.handle({ jsonrpc: '2.0', method: 'ui/notifications/initialized' })
    expect(toolsChanged).toHaveBeenCalledTimes(1)

    const listing = bridge.listAppTools()
    const list = sent.at(-1)!
    expect(list.method).toBe('tools/list')
    await bridge.handle({ jsonrpc: '2.0', id: list.id, result: { tools: [{ name: 'edit-text' }] } })
    expect(await listing).toEqual([{ name: 'edit-text' }])

    const calling = bridge.callAppTool('edit-text', { text: 'Hi' })
    const call = sent.at(-1)!
    expect(call).toMatchObject({ method: 'tools/call', params: { name: 'edit-text', arguments: { text: 'Hi' } } })
    await bridge.handle({ jsonrpc: '2.0', id: call.id, error: { code: -32000, message: 'No text box selected' } })
    await expect(calling).rejects.toThrow('No text box selected')

    await bridge.handle({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    expect(toolsChanged).toHaveBeenCalledTimes(2)
  })
})

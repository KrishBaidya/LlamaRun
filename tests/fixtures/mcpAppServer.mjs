// A tiny MCP server with an MCP App, for tests/mcpAppsServer.test.ts.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server({ name: 'weather', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } })
const ui = { resourceUri: 'ui://weather/dash' }
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'get_weather', description: 'Weather for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } } }, _meta: { ui } },
    { name: 'refresh_weather', description: 'Refresh the dashboard', inputSchema: { type: 'object' }, _meta: { ui: { ...ui, visibility: ['app'] } } },
    { name: 'model_only', description: 'Not for apps', inputSchema: { type: 'object' }, _meta: { ui: { visibility: ['model'] } } }
  ]
}))
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const supported = Boolean(server.getClientCapabilities()?.extensions?.['io.modelcontextprotocol/ui'])
  return { content: [{ type: 'text', text: `${req.params.name}: Sunny (ui ${supported})` }], structuredContent: { temp: 31, city: req.params.arguments?.city } }
})
server.setRequestHandler(ReadResourceRequestSchema, async (req) => ({
  contents: [
    {
      uri: req.params.uri,
      mimeType: 'text/html;profile=mcp-app',
      text: '<!doctype html><html><head></head><body>Weather</body></html>',
      _meta: { ui: { csp: { connectDomains: ['https://api.weather.com', 'not a url'] }, permissions: { clipboardWrite: {} }, prefersBorder: false } }
    }
  ]
}))
await server.connect(new StdioServerTransport())

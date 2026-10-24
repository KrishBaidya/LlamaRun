/**
 * The plugin marketplace. It doesn't exist yet: plugins (and the model, through
 * them) are told so, and fall back to the MCP directory or making a plugin.
 */
export interface MarketplaceResults {
  available: boolean
  plugins: { id: string; name: string; description: string; version: string; author: string }[]
  message?: string
}

export async function searchMarketplace(_query: string): Promise<MarketplaceResults> {
  return { available: false, plugins: [], message: 'The Llama Run plugin marketplace is not available yet.' }
}

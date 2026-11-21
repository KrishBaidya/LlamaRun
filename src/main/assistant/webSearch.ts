import { BASE_SERVER_URL } from '@shared/constants'

/**
 * web_search: Google Search through the Llama Run server (Gemini with search
 * grounding), for every model, local ones included. The answer comes with its
 * sources so the model can cite them or read a page with web_fetch.
 */

export const SEARCH_URL = `${BASE_SERVER_URL}/api/v1/search`

export interface SearchResponse {
  answer?: string
  sources?: { title?: string; url?: string }[]
  error?: string
  code?: string
}

/** The search result as tool output: the answer, then numbered sources. */
export function formatSearch(query: string, data: SearchResponse): string {
  const sources = (data.sources ?? []).filter((s) => s.url)
  const list = sources.map((s, i) => `[${i + 1}] ${s.title?.trim() || s.url} - ${s.url}`).join('\n')
  return `Web search: ${query}\n\n${data.answer?.trim() || '(no answer)'}${list ? `\n\nSources:\n${list}` : ''}`
}

export async function webSearch(query: string, token: string, signal?: AbortSignal): Promise<string> {
  if (!token) throw new Error('Web search needs the user to sign in to Llama Run.')
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
    signal: signal ?? AbortSignal.timeout(60_000)
  })
  const data = (await res.json().catch(() => ({}))) as SearchResponse
  if (!res.ok) {
    if (res.status === 404) throw new Error('Web search is not available on this server yet.')
    throw new Error(data.error ? `Web search failed: ${data.error}` : `Web search failed (HTTP ${res.status})`)
  }
  return formatSearch(query, data)
}

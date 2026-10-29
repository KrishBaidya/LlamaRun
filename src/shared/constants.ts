// Server endpoints. Override with environment variables for local development
// instead of swapping constants between build configurations.
const env: Record<string, string | undefined> =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

// Vite statically replaces `import.meta.env` at build time (electron-vite builds main,
// preload and renderer with it), so this is `PROD: true` in production builds and false
// under `electron-vite dev` / vitest. The cast keeps the node tsconfig (no vite/client
// types) happy; esbuild strips it, leaving a literal `import.meta.env` for Vite to replace.
const viteEnv = (import.meta as unknown as { env?: { PROD?: boolean } }).env
const isProductionBuild = viteEnv?.PROD === true

export const BASE_SERVER_URL = (
  env.LLAMARUN_SERVER_URL || (isProductionBuild ? 'https://llamarun.krishbaidya.me' : 'http://localhost:3000')
).replace(/\/+$/, '')
export const MCP_DIRECTORY_URL = env.LLAMARUN_MCP_DIRECTORY_URL ?? 'https://mcp.krishbaidya.me'
export const OLLAMA_HOST = env.OLLAMA_HOST ?? 'http://127.0.0.1:11434'

// PostHog project key. It can only send events, never read them, so it is safe to ship.
// Analytics only sends from production builds; LLAMARUN_ANALYTICS_DEBUG=1 logs events to
// the console instead (in any build) so development and tests never add to real data.
export const POSTHOG_KEY = env.LLAMARUN_POSTHOG_KEY ?? 'phc_pLHS7YjK5evuSlUfG6JBpcZGXZLOPFpIhrfOYh1Q1pc'
export const POSTHOG_HOST = env.LLAMARUN_POSTHOG_HOST ?? 'https://us.i.posthog.com'
export const ANALYTICS_DEBUG = env.LLAMARUN_ANALYTICS_DEBUG === '1'
export const ANALYTICS_ENABLED_BUILD = isProductionBuild

export const PROTOCOL = 'llama-run'
export const SDK_VERSION = '1.0'

export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+A'
export const FALLBACK_HOTKEY = 'CommandOrControl+Shift+S'
export const DEFAULT_CLOUD_MODEL = 'gemini-2.5-flash'
export const SEARCH_DEBOUNCE_MS = 300

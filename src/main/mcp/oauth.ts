import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { safeStorage, shell } from 'electron'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { readJson, writeJson } from '../jsonFile'
import { userDataPath } from '../paths'

/**
 * Signing in to remote MCP servers that use OAuth (Linear, Notion, Atlassian,
 * GitHub's hosted server…): Llama Run registers itself with the server, opens
 * the sign-in page in the user's browser and catches the redirect on a
 * loopback address, as Claude Code and Cursor do. Tokens are kept per server,
 * encrypted with the OS keychain, and refreshed by the SDK.
 */

/** The loopback port the browser is sent back to. Fixed, because the server registers the redirect address. */
export const CALLBACK_PORT = 47823
const REDIRECT = `http://127.0.0.1:${CALLBACK_PORT}/callback`
/** How long a sign-in waits for the browser. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

interface Saved {
  client?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  verifier?: string
}

const storePath = (): string => userDataPath('mcp-auth.json')

function readAll(): Record<string, Saved> {
  const raw = readJson<Record<string, string>>(storePath(), {})
  const out: Record<string, Saved> = {}
  for (const [name, value] of Object.entries(raw)) {
    try {
      const text = value.startsWith('{') ? value : safeStorage.decryptString(Buffer.from(value, 'base64'))
      out[name] = JSON.parse(text) as Saved
    } catch {
      /* unreadable on this machine: sign in again */
    }
  }
  return out
}

function writeOne(name: string, saved: Saved | null): void {
  const raw = readJson<Record<string, string>>(storePath(), {})
  if (!saved) delete raw[name]
  else {
    const text = JSON.stringify(saved)
    raw[name] = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text).toString('base64') : text
  }
  writeJson(storePath(), raw)
}

/** Forgets a server's sign-in (when it is removed, or the user signs out). */
export function forgetSignIn(name: string): void {
  writeOne(name, null)
}

/** Sign-ins waiting for the browser, by OAuth state. */
const waiting = new Map<string, { resolve: (code: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>()
let server: Server | null = null

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function closeServer(): void {
  server?.close()
  server = null
}

function ensureCallbackServer(): Promise<void> {
  if (server) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const state = url.searchParams.get('state') ?? ''
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error_description') || url.searchParams.get('error')
      const pending = waiting.get(state)
      const ok = Boolean(pending && code)
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Llama Run</title><body style="font-family:system-ui;padding:3rem;text-align:center">${
          ok ? '<h2>Signed in</h2><p>You can close this tab and go back to Llama Run.</p>' : `<h2>Sign-in didn't finish</h2><p>${escapeHtml(error || 'This link has expired.')}</p>`
        }</body>`
      )
      if (!pending) return
      clearTimeout(pending.timer)
      waiting.delete(state)
      if (code) pending.resolve(code)
      else pending.reject(new Error(error || 'Sign-in was cancelled'))
      if (!waiting.size) closeServer()
    })
    s.once('error', (err) => {
      server = null
      reject(new Error(`Couldn't listen for the sign-in on port ${CALLBACK_PORT}: ${err.message}`))
    })
    s.listen(CALLBACK_PORT, '127.0.0.1', () => resolve())
    server = s
  })
}

/**
 * One server's OAuth client. With `interactive` off (connecting at startup),
 * a server that needs a fresh sign-in reports that instead of opening the
 * browser on its own; the user signs in from Settings > MCP.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  private readonly stateValue = randomUUID()
  /** Set once the SDK asked to open the sign-in page. */
  signInStarted = false
  /** The authorization code, once the browser comes back (interactive sign-ins only). */
  code: Promise<string> | null = null

  constructor(
    private readonly name: string,
    private readonly interactive: boolean,
    private readonly open: (url: string) => Promise<void> = (url) => shell.openExternal(url)
  ) {}

  get redirectUrl(): string {
    return REDIRECT
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Llama Run',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }

  state(): string {
    return this.stateValue
  }

  private load(): Saved {
    return readAll()[this.name] ?? {}
  }

  private save(patch: Partial<Saved>): void {
    writeOne(this.name, { ...this.load(), ...patch })
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.load().client
  }

  saveClientInformation(client: OAuthClientInformationMixed): void {
    this.save({ client })
  }

  tokens(): OAuthTokens | undefined {
    return this.load().tokens
  }

  saveTokens(tokens: OAuthTokens): void {
    this.save({ tokens })
  }

  saveCodeVerifier(verifier: string): void {
    this.save({ verifier })
  }

  codeVerifier(): string {
    const verifier = this.load().verifier
    if (!verifier) throw new Error('No sign-in in progress')
    return verifier
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') return forgetSignIn(this.name)
    const saved = this.load()
    if (scope === 'client') delete saved.client
    if (scope === 'tokens') delete saved.tokens
    if (scope === 'verifier') delete saved.verifier
    writeOne(this.name, saved)
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    this.signInStarted = true
    if (!this.interactive) return
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The server gave a sign-in address that is not a web page')
    await ensureCallbackServer()
    this.code = this.waitForCode()
    this.code.catch(() => undefined)
    await this.open(url.toString())
  }

  /** Resolves with the authorization code once the browser comes back. */
  private waitForCode(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(this.stateValue)
        if (!waiting.size) closeServer()
        reject(new Error('Sign-in timed out. Try again from Settings > MCP.'))
      }, SIGN_IN_TIMEOUT_MS)
      waiting.set(this.stateValue, { resolve, reject, timer })
    })
  }
}

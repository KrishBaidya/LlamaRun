import { EventEmitter } from 'node:events'
import { safeStorage, shell } from 'electron'
import type { PlanInfo, PlanStatus, UsageInfo, UserProfile } from '@shared/types'
import { BASE_SERVER_URL, PROTOCOL } from '@shared/constants'
import { readJson, writeJson } from './jsonFile'
import { userDataPath } from './paths'

interface StoredAuth {
  /** base64 of the safeStorage-encrypted JWT (or plain text when encryption is unavailable). */
  token: string
  encrypted: boolean
  name: string
  email: string
  photoURL: string
  /** Cached from /api/v1/me so the UI has something to show offline. */
  plan?: PlanInfo
  usage?: UsageInfo
}

const EMPTY: StoredAuth = { token: '', encrypted: false, name: 'User', email: '', photoURL: '' }

/** Account fields read from the server. */
export interface AccountInfo {
  name: string
  email: string
  photoURL: string
  plan?: PlanInfo
  usage?: UsageInfo
}

const PLAN_STATUSES: readonly PlanStatus[] = ['active', 'pending', 'halted', 'cancelled', 'none']

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

function parsePlan(value: unknown): PlanInfo | undefined {
  const p = record(value)
  if (p.tier !== 'free' && p.tier !== 'pro') return undefined
  const status = PLAN_STATUSES.includes(p.status as PlanStatus) ? (p.status as PlanStatus) : 'none'
  return { tier: p.tier, status, currentPeriodEnd: str(p.currentPeriodEnd) || null }
}

function parseUsage(value: unknown): UsageInfo | undefined {
  const u = record(value)
  const used = num(u.used)
  const limit = num(u.limit)
  if (used === undefined || limit === undefined) return undefined
  return { used: Math.max(0, used), limit: Math.max(0, limit), periodEnd: str(u.periodEnd) }
}

/**
 * Maps a `GET /api/v1/me` body (or the legacy `/api/auth/get-profile` body,
 * which only has `profile`) to the fields we store.
 */
export function parseAccount(body: unknown): AccountInfo {
  const b = record(body)
  const p = record(b.profile)
  return {
    name: str(p.displayName) || 'User',
    email: str(p.email),
    photoURL: str(p.photoURL),
    plan: parsePlan(b.plan),
    usage: parseUsage(b.usage)
  }
}

/** How long to wait after a cloud reply before re-reading usage, so bursts make one request. */
const REFRESH_DEBOUNCE_MS = 2000

class AuthService extends EventEmitter<{ changed: [UserProfile] }> {
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private inflight: Promise<UserProfile> | undefined

  private get path(): string {
    return userDataPath('auth.json')
  }

  private read(): StoredAuth {
    return { ...EMPTY, ...readJson<Partial<StoredAuth>>(this.path, {}) }
  }

  get token(): string {
    const s = this.read()
    if (!s.token) return ''
    if (!s.encrypted) return s.token
    try {
      return safeStorage.decryptString(Buffer.from(s.token, 'base64'))
    } catch {
      return ''
    }
  }

  profile(): UserProfile {
    const s = this.read()
    const signedIn = Boolean(s.token)
    return {
      signedIn,
      name: s.name,
      email: s.email,
      photoURL: s.photoURL,
      ...(signedIn && s.plan ? { plan: s.plan } : {}),
      ...(signedIn && s.usage ? { usage: s.usage } : {})
    }
  }

  openLogin(): void {
    void shell.openExternal(`${BASE_SERVER_URL}/login`)
  }

  /** Pricing page; it sends the browser back with `llama-run://billing?status=…` after checkout. */
  openUpgrade(): void {
    void shell.openExternal(`${BASE_SERVER_URL}/pricing?from=app`)
  }

  /** Account page, where a subscription is managed or cancelled. */
  openAccount(): void {
    void shell.openExternal(`${BASE_SERVER_URL}/profile`)
  }

  /** Handles `llama-run://auth?token=<JWT>` (and any other llama-run:// URL carrying a token). */
  async handleProtocolUrl(rawUrl: string): Promise<boolean> {
    if (!rawUrl.startsWith(`${PROTOCOL}://`)) return false
    let token: string | null = null
    try {
      token = new URL(rawUrl).searchParams.get('token')
    } catch {
      return false
    }
    if (!token) return false
    await this.setToken(token)
    return true
  }

  async setToken(token: string): Promise<void> {
    const encrypted = safeStorage.isEncryptionAvailable()
    const stored: StoredAuth = {
      ...this.read(),
      token: encrypted ? safeStorage.encryptString(token).toString('base64') : token,
      encrypted
    }
    writeJson(this.path, stored)
    // A refresh already in flight was for the previous token; read the account again for this one.
    await this.inflight
    await this.refreshProfile()
  }

  /** Re-reads the account (plan and usage) from the server. Concurrent calls share one request. */
  refreshProfile(): Promise<UserProfile> {
    this.inflight ??= this.fetchProfile().finally(() => (this.inflight = undefined))
    return this.inflight
  }

  /** Refresh soon, coalescing repeated calls (e.g. after every cloud reply). */
  scheduleRefresh(delayMs = REFRESH_DEBOUNCE_MS): void {
    clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      void this.refreshProfile()
    }, delayMs)
  }

  private async fetchProfile(): Promise<UserProfile> {
    const token = this.token
    if (token) {
      try {
        const headers = { Authorization: `Bearer ${token}` }
        let res = await fetch(`${BASE_SERVER_URL}/api/v1/me`, { headers })
        // Servers from before /api/v1 only have the profile endpoint.
        if (res.status === 404) res = await fetch(`${BASE_SERVER_URL}/api/auth/get-profile`, { headers })
        // A sign-in or sign-out while the request was out wins over its answer.
        if (res.status === 401) {
          // The token expired or was revoked: sign out so the UI asks to sign in again.
          if (this.token === token) this.clear()
        } else if (res.ok) {
          const account = parseAccount(await res.json())
          if (this.token === token) {
            const { plan: _plan, usage: _usage, ...rest } = this.read()
            writeJson(this.path, { ...rest, ...account } satisfies StoredAuth)
          }
        }
      } catch {
        // Offline: keep the cached profile.
      }
    }
    const profile = this.profile()
    this.emit('changed', profile)
    return profile
  }

  private clear(): void {
    clearTimeout(this.refreshTimer)
    writeJson(this.path, EMPTY)
  }

  signOut(): void {
    this.clear()
    this.emit('changed', this.profile())
  }
}

export const auth = new AuthService()

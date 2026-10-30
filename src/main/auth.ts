import { EventEmitter } from 'node:events'
import { safeStorage, shell } from 'electron'
import type { PlanInfo, PlanStatus, UsageInfo, UserProfile } from '@shared/types'
import { BASE_SERVER_URL, PROTOCOL } from '@shared/constants'
import { analytics } from './analytics'
import { readJson, writeJson } from './jsonFile'
import { userDataPath } from './paths'

interface StoredAuth {
  /** base64 of the safeStorage-encrypted JWT (or plain text when encryption is unavailable). */
  token: string
  encrypted: boolean
  name: string
  email: string
  photoURL: string
  /** The account's id (Firebase uid), when the server sends it. Links app and website analytics. */
  uid?: string
  /** Cached from /api/v1/me so the UI has something to show offline. */
  plan?: PlanInfo
  usage?: UsageInfo
  /** When the account was last read from the server (ms since epoch). */
  fetchedAt?: number
}

/** The profile photo, kept on disk so it shows offline and isn't downloaded on every open. */
interface CachedAvatar {
  url: string
  dataUrl: string
}

const EMPTY: StoredAuth = { token: '', encrypted: false, name: 'User', email: '', photoURL: '' }

/** Account fields read from the server. */
export interface AccountInfo {
  name: string
  email: string
  photoURL: string
  uid?: string
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
  const uid = str(b.uid) || str(p.uid)
  return {
    name: str(p.displayName) || 'User',
    email: str(p.email),
    photoURL: str(p.photoURL),
    ...(uid ? { uid } : {}),
    plan: parsePlan(b.plan),
    usage: parseUsage(b.usage)
  }
}

/** How long to wait after a cloud reply before re-reading usage, so bursts make one request. */
const REFRESH_DEBOUNCE_MS = 2000
/**
 * A profile read this recently is reused instead of asking the server again. Usage stays
 * current anyway: every cloud reply schedules a forced refresh.
 */
export const PROFILE_FRESH_MS = 5 * 60_000
const MAX_AVATAR_BYTES = 512 * 1024

class AuthService extends EventEmitter<{ changed: [UserProfile] }> {
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private inflight: Promise<UserProfile> | undefined
  // undefined = not read from disk yet.
  private avatarCache: CachedAvatar | null | undefined
  /** Photo URLs already tried this session, so a broken one isn't fetched on every refresh. */
  private avatarTried = new Set<string>()

  private get path(): string {
    return userDataPath('auth.json')
  }

  private get avatarPath(): string {
    return userDataPath('cache', 'avatar.json')
  }

  private cachedAvatar(url: string): string | undefined {
    if (this.avatarCache === undefined) {
      const stored = readJson<Partial<CachedAvatar>>(this.avatarPath, {})
      this.avatarCache = stored.url && stored.dataUrl ? { url: stored.url, dataUrl: stored.dataUrl } : null
    }
    return url && this.avatarCache?.url === url ? this.avatarCache.dataUrl : undefined
  }

  /** Downloads the profile photo once; returns true when a new copy was saved. */
  private async cacheAvatar(url: string): Promise<boolean> {
    if (!url || this.cachedAvatar(url) || this.avatarTried.has(url)) return false
    this.avatarTried.add(url)
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      const type = res.headers.get('content-type')?.split(';')[0].trim() ?? ''
      if (!res.ok || !type.startsWith('image/')) return false
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length > MAX_AVATAR_BYTES || this.read().photoURL !== url) return false
      this.avatarCache = { url, dataUrl: `data:${type};base64,${bytes.toString('base64')}` }
      writeJson(this.avatarPath, this.avatarCache)
      return true
    } catch {
      return false
    }
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
      photoURL: this.cachedAvatar(s.photoURL) ?? s.photoURL,
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
    const profile = await this.refreshProfile()
    if (profile.signedIn) analytics.track('signed_in', { plan: profile.plan?.tier ?? 'free' })
  }

  /**
   * Re-reads the account (plan and usage) from the server. Concurrent calls share one request.
   * With `maxAgeMs`, a profile read that recently is returned without asking the server.
   */
  refreshProfile({ maxAgeMs = 0 }: { maxAgeMs?: number } = {}): Promise<UserProfile> {
    const s = this.read()
    const age = Date.now() - (s.fetchedAt ?? 0)
    if (!this.inflight && maxAgeMs > 0 && s.token && age >= 0 && age < maxAgeMs) {
      // Fresh enough; still pick up a photo saved before the avatar cache existed.
      void this.cacheAvatar(s.photoURL).then((saved) => saved && this.emit('changed', this.profile()))
      return Promise.resolve(this.profile())
    }
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
          if (this.token === token) {
            this.clear()
            analytics.reset()
          }
        } else if (res.ok) {
          const account = parseAccount(await res.json())
          if (this.token === token) {
            const { plan: _plan, usage: _usage, ...rest } = this.read()
            writeJson(this.path, { ...rest, ...account, fetchedAt: Date.now() } satisfies StoredAuth)
            if (account.uid) analytics.identify(account.uid, { email: account.email, plan: account.plan?.tier ?? 'free' })
            await this.cacheAvatar(account.photoURL)
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
    this.avatarCache = null
    this.avatarTried.clear()
    writeJson(this.avatarPath, {})
  }

  signOut(): void {
    analytics.track('signed_out')
    this.clear()
    analytics.reset()
    this.emit('changed', this.profile())
  }
}

export const auth = new AuthService()

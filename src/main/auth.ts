import { EventEmitter } from 'node:events'
import { safeStorage, shell } from 'electron'
import type { UserProfile } from '@shared/types'
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
}

const EMPTY: StoredAuth = { token: '', encrypted: false, name: 'User', email: '', photoURL: '' }

class AuthService extends EventEmitter<{ changed: [UserProfile] }> {
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
    return { signedIn: Boolean(s.token), name: s.name, email: s.email, photoURL: s.photoURL }
  }

  openLogin(): void {
    void shell.openExternal(`${BASE_SERVER_URL}/login`)
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
    await this.refreshProfile()
  }

  async refreshProfile(): Promise<UserProfile> {
    const token = this.token
    if (token) {
      try {
        const res = await fetch(`${BASE_SERVER_URL}/api/auth/get-profile`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.ok) {
          const body = (await res.json()) as {
            profile?: { displayName?: string; email?: string; photoURL?: string }
          }
          const p = body.profile ?? {}
          writeJson(this.path, {
            ...this.read(),
            name: p.displayName || 'User',
            email: p.email ?? '',
            photoURL: p.photoURL ?? ''
          })
        }
      } catch {
        // Offline: keep the cached profile.
      }
    }
    const profile = this.profile()
    this.emit('changed', profile)
    return profile
  }

  signOut(): void {
    writeJson(this.path, EMPTY)
    this.emit('changed', this.profile())
  }
}

export const auth = new AuthService()

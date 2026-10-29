import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { release } from 'node:os'
import { PostHog } from 'posthog-node'
import { ANALYTICS_DEBUG, ANALYTICS_ENABLED_BUILD, POSTHOG_HOST, POSTHOG_KEY } from '@shared/constants'
import { readJson, writeJson } from './jsonFile'
import { userDataPath } from './paths'
import { settings } from './settings'

/**
 * Anonymous product analytics (PostHog). Events carry names and small counts only: never
 * message text, replies, file names, paths, commands or URLs. Users can turn it off in
 * Settings → General, and nothing is sent outside production builds.
 */

type Value = string | number | boolean | null | undefined | Record<string, number>
export type Props = Record<string, Value>

/** The parts of the PostHog client this module uses, so tests can pass a fake. */
export interface AnalyticsClient {
  capture(message: { distinctId: string; event: string; properties?: Record<string, unknown> }): void
  alias(message: { distinctId: string; alias: string }): void
  identify(message: { distinctId: string; properties?: Record<string, unknown> }): void
  shutdown(): Promise<void>
}

interface Stored {
  installId?: string
  userId?: string
}

// Property names that could carry what a person typed or where their files are. Dropped
// whatever the caller passes, as a guard against a future call site sending them by mistake.
const BLOCKED = /^(prompt|prompts|content|text|message|messages|reply|path|paths|file|files|filename|email|token|url|command|args|\$ai_input|\$ai_output_choices)$/i

const DAY_MS = 24 * 60 * 60 * 1000

function consoleClient(): AnalyticsClient {
  const log = (kind: string, data: unknown): void => console.log(`[analytics] ${kind}`, JSON.stringify(data))
  return {
    capture: (m) => log(m.event, m.properties ?? {}),
    alias: (m) => log('$alias', m),
    identify: (m) => log('$identify', { distinctId: m.distinctId }),
    shutdown: async () => undefined
  }
}

function defaultClient(): AnalyticsClient | null {
  if (ANALYTICS_DEBUG) return consoleClient()
  if (!ANALYTICS_ENABLED_BUILD || !POSTHOG_KEY) return null
  return new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST, flushAt: 20, flushInterval: 30_000 })
}

export class Analytics {
  private client: AnalyticsClient | null | undefined
  private stored: Stored | null = null
  private heartbeat: NodeJS.Timeout | null = null
  /** The install id was created by this run: the first launch after installing. */
  private createdId = false

  constructor(private readonly makeClient: () => AnalyticsClient | null = defaultClient) {}

  private get path(): string {
    return userDataPath('analytics.json')
  }

  private get data(): Stored {
    this.stored ??= readJson<Stored>(this.path, {})
    return this.stored
  }

  private save(patch: Stored): void {
    this.stored = { ...this.data, ...patch }
    writeJson(this.path, this.stored)
  }

  /** The client to send with, or null when there's none for this build or the user turned analytics off. */
  private active(): AnalyticsClient | null {
    if (this.client === undefined) this.client = this.makeClient()
    if (!this.client || settings.get('telemetryEnabled') === false) return null
    return this.client
  }

  /** The anonymous id for this install, created on first use. */
  get installId(): string {
    if (!this.data.installId) {
      this.save({ installId: randomUUID() })
      this.createdId = true
    }
    return this.data.installId as string
  }

  private get distinctId(): string {
    return this.data.userId ?? this.installId
  }

  /** Called once the app is ready: records the launch and starts the daily heartbeat. */
  start(firstRun: boolean): void {
    void this.installId
    if (this.createdId) this.track('app_installed')
    this.track('app_started', { first_run: firstRun })
    this.heartbeat ??= setInterval(() => this.track('app_active'), DAY_MS)
    this.heartbeat.unref?.()
  }

  track(event: string, props: Props = {}): void {
    const client = this.active()
    if (!client) return
    const properties: Record<string, unknown> = {
      app_version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      $os: process.platform === 'win32' ? 'Windows' : process.platform,
      $os_version: release(),
      install_id: this.installId
    }
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || BLOCKED.test(key)) continue
      properties[key] = value
    }
    try {
      client.capture({ distinctId: this.distinctId, event, properties })
    } catch (e) {
      console.warn('analytics: capture failed', e)
    }
  }

  /** Links this install to the signed-in account, so app and website activity share one person. */
  identify(userId: string, person: { email?: string; plan?: string } = {}): void {
    if (!userId) return
    const client = this.active()
    const previous = this.data.userId
    this.save({ userId })
    if (!client) return
    try {
      if (previous !== userId) client.alias({ distinctId: userId, alias: this.installId })
      client.identify({ distinctId: userId, properties: { $set: { ...person, app_version: app.getVersion() } } })
    } catch (e) {
      console.warn('analytics: identify failed', e)
    }
  }

  /** After sign-out, events belong to the anonymous install again. */
  reset(): void {
    if (this.data.userId) this.save({ userId: undefined })
  }

  async shutdown(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    if (this.client) await this.client.shutdown().catch(() => undefined)
  }
}

export const analytics = new Analytics()

/**
 * Utility-process entry that owns the Cua Driver runtime. It runs apart from
 * the main process so a native crash or hang can't take the app down with it;
 * computer/driver.ts restarts it when it exits.
 *
 * On Windows the configured constructor runs the driver inside this process:
 * no daemon, socket or extra executable.
 */
import type { CuaDriverLike, DriverAuthorizationDecision, DriverAuthorizationHost, DriverAuthorizationRequest } from '@trycua/cua-driver'
import { errorText, sdkSpecifier, toDriverResult, type WorkerRequest, type WorkerResponse } from './protocol'

const port = process.parentPort
const post = (message: WorkerResponse): void => port.postMessage(message)

let driver: CuaDriverLike

/** Approval questions sent to the main process, by id, waiting for the user's answer. */
const asks = new Map<number, (allow: boolean | null) => void>()
let askSeq = 0

type Sdk = typeof import('@trycua/cua-driver')

/**
 * Residual boundaries (attaching to the user's signed-in browser) go to the
 * user as an approval card in the chat whose session asked. Nothing here
 * decides on its own: an unanswered question is cancelled when the driver's
 * request expires.
 */
function authorizationHost(sdk: Sdk): DriverAuthorizationHost {
  return {
    async authorize(request: DriverAuthorizationRequest, options?: { signal: AbortSignal }): Promise<DriverAuthorizationDecision> {
      if (options?.signal.aborted) return { action: sdk.DriverAuthorizationAction.Cancel, requestDigest: request.requestDigest }
      const id = ++askSeq
      const expiresAt = Number(request.expiresUnixMs)
      const allow = await new Promise<boolean | null>((resolve) => {
        const done = (answer: boolean | null): void => {
          clearTimeout(timer)
          asks.delete(id)
          resolve(answer)
        }
        const timer = setTimeout(() => done(null), Math.max(0, expiresAt - Date.now()))
        asks.set(id, done)
        options?.signal.addEventListener('abort', () => done(null), { once: true })
        post({ authorize: { id, session: request.publicSession, summary: request.humanSummary, riskClass: request.riskClass, expiresAt } })
      })
      if (allow === null) post({ withdraw: id })
      const action = allow === null ? sdk.DriverAuthorizationAction.Cancel : allow ? sdk.DriverAuthorizationAction.Allow : sdk.DriverAuthorizationAction.Deny
      return { action, requestDigest: request.requestDigest }
    }
  }
}

async function start(): Promise<void> {
  try {
    // ESM-only package: loaded with import(), not require().
    const sdk = (await import(sdkSpecifier(__dirname))) as Sdk
    const standard = sdk.SessionPermissionMode.Standard
    driver = sdk.CuaDriver.createConfiguredWithAuthorizationHost(
      {
        claudeCodeCompatibility: false,
        authorization: {
          allowedModes: [standard],
          compatibilityMode: standard,
          unrestrictedAcknowledged: false,
          // Ceilings only: Llama Run ends each session when its reply ends.
          maxSessionTtlSeconds: 8n * 3600n,
          maxIdleTtlSeconds: 30n * 60n
        }
      },
      authorizationHost(sdk)
    )
    post({ ready: true })
  } catch (err) {
    post({ fatal: (err as Error)?.message ?? String(err) })
    process.exit(1)
  }
}

const started = start()

port.on('message', async ({ data }: { data: WorkerRequest }) => {
  if ('authorized' in data) {
    asks.get(data.authorized)?.(data.allow)
    return
  }
  await started
  if ('shutdown' in data) {
    // The SDK's order: stop admitting work and wait for admitted calls, then free the native handle.
    await driver.shutdown().catch(() => undefined)
    if ('uniffiDestroy' in driver && typeof driver.uniffiDestroy === 'function') driver.uniffiDestroy()
    post({ id: data.id, result: { text: '', images: [], isError: false } })
    process.exit(0)
  }
  try {
    const result = await driver.callTool(data.tool, JSON.stringify(data.args))
    post({ id: data.id, result: toDriverResult(result) })
  } catch (err) {
    post({ id: data.id, error: errorText(err) })
  }
})

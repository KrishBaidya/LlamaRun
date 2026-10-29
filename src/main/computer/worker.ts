/**
 * Utility-process entry that owns the Cua Driver runtime. It runs apart from
 * the main process so a native crash or hang can't take the app down with it;
 * computer/driver.ts restarts it when it exits.
 *
 * On Windows `CuaDriver.create()` runs the driver inside this process: no
 * daemon, socket or extra executable.
 */
import type { CuaDriverLike } from '@trycua/cua-driver'
import { sdkSpecifier, toDriverResult, type WorkerRequest, type WorkerResponse } from './protocol'

const port = process.parentPort
const post = (message: WorkerResponse): void => port.postMessage(message)

let driver: CuaDriverLike

async function start(): Promise<void> {
  try {
    // ESM-only package: loaded with import(), not require().
    const { CuaDriver } = (await import(sdkSpecifier(__dirname))) as typeof import('@trycua/cua-driver')
    driver = CuaDriver.create()
    post({ ready: true })
  } catch (err) {
    post({ fatal: (err as Error)?.message ?? String(err) })
    process.exit(1)
  }
}

const started = start()

port.on('message', async ({ data }: { data: WorkerRequest }) => {
  await started
  if ('shutdown' in data) {
    await driver.shutdown().catch(() => undefined)
    post({ id: data.id, result: { text: '', images: [], isError: false } })
    process.exit(0)
  }
  try {
    const result = await driver.callTool(data.tool, JSON.stringify(data.args))
    post({ id: data.id, result: toDriverResult(result) })
  } catch (err) {
    post({ id: data.id, error: (err as Error)?.message ?? String(err) })
  }
})

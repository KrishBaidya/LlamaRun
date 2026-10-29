import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-analytics-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.', getVersion: () => '9.9.9' }
}))

const { Analytics } = await import('../src/main/analytics')
const { settings } = await import('../src/main/settings')
const { parseAccount } = await import('../src/main/auth')

afterAll(() => rmSync(userData, { recursive: true, force: true }))

function fakeClient() {
  return {
    capture: vi.fn(),
    alias: vi.fn(),
    identify: vi.fn(),
    shutdown: vi.fn(async () => undefined)
  }
}

describe('analytics', () => {
  beforeEach(() => {
    rmSync(join(userData, 'analytics.json'), { force: true })
    settings.set({ telemetryEnabled: true })
  })

  it('keeps one install id across restarts', () => {
    const first = new Analytics(() => fakeClient()).installId
    const second = new Analytics(() => fakeClient()).installId
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(second).toBe(first)
  })

  it('records installs once, then launches', async () => {
    const client = fakeClient()
    const a = new Analytics(() => client)
    a.start(true)
    await a.shutdown()
    const events = client.capture.mock.calls.map(([m]) => m.event)
    expect(events).toEqual(['app_installed', 'app_started'])

    const again = fakeClient()
    const b = new Analytics(() => again)
    b.start(false)
    await b.shutdown()
    expect(again.capture.mock.calls.map(([m]) => m.event)).toEqual(['app_started'])
  })

  it('adds the common properties and drops anything that could hold text or paths', () => {
    const client = fakeClient()
    const a = new Analytics(() => client)
    a.track('message_sent', { model: 'gemma3', prompt: 'secret', path: 'C:\\x', email: 'a@b.c', $ai_input: 'hi', images: 2, missing: undefined })
    const props = client.capture.mock.calls[0][0].properties
    expect(props).toMatchObject({ app_version: '9.9.9', platform: process.platform, model: 'gemma3', images: 2, install_id: a.installId })
    for (const key of ['prompt', 'path', 'email', '$ai_input', 'missing']) expect(props).not.toHaveProperty(key)
  })

  it('sends nothing when the user turned it off, or when there is no client', () => {
    const client = fakeClient()
    settings.set({ telemetryEnabled: false })
    new Analytics(() => client).track('app_started')
    expect(client.capture).not.toHaveBeenCalled()

    settings.set({ telemetryEnabled: true })
    expect(() => new Analytics(() => null).track('app_started')).not.toThrow()
  })

  it('links the install to the account on sign-in, once', () => {
    const client = fakeClient()
    const a = new Analytics(() => client)
    a.identify('uid-1', { email: 'ada@example.com', plan: 'free' })
    a.identify('uid-1', { plan: 'pro' })
    expect(client.alias).toHaveBeenCalledTimes(1)
    expect(client.alias).toHaveBeenCalledWith({ distinctId: 'uid-1', alias: a.installId })
    a.track('message_sent')
    expect(client.capture.mock.calls.at(-1)?.[0].distinctId).toBe('uid-1')

    a.reset()
    a.track('message_sent')
    expect(client.capture.mock.calls.at(-1)?.[0].distinctId).toBe(a.installId)
  })

  it('keeps the choice through Reset to Defaults', () => {
    settings.set({ telemetryEnabled: false })
    expect(settings.reset().telemetryEnabled).toBe(false)
  })
})

describe('parseAccount uid', () => {
  it('reads the account id when the server sends it', () => {
    expect(parseAccount({ uid: 'abc', profile: { email: 'x@y.z' } }).uid).toBe('abc')
    expect(parseAccount({ profile: { email: 'x@y.z' } })).not.toHaveProperty('uid')
  })
})

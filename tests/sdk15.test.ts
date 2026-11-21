import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.', getVersion: () => '0' } }))
const { PERMISSIONS } = await import('../src/main/plugins/permissions')
const { checkSdkVersion, SDK_VERSION } = await import('../src/main/plugins/manifest')

describe('plugin SDK 1.5', () => {
  it('offers the usage permission, enforced, and still accepts plugins targeting 1.5', () => {
    expect(SDK_VERSION).toBe('1.6')
    expect(PERMISSIONS.usage).toMatchObject({ id: 'usage', enforced: true, risk: 'low' })
    expect(() => checkSdkVersion('1.5')).not.toThrow()
    expect(() => checkSdkVersion('1.7')).toThrow()
  })
})

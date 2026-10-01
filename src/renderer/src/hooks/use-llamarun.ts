import { useCallback, useEffect, useState } from 'react'
import type { EventChannel, EventChannels } from '@shared/ipc'
import type { Settings, UserProfile } from '@shared/types'

export const api = window.llamarun

/** Subscribe to a main-process push channel for the lifetime of the component. */
export function useIpcEvent<E extends EventChannel>(channel: E, listener: (payload: EventChannels[E]) => void): void {
  useEffect(() => api.on(channel, listener), [channel, listener])
}

export function useSettings(): [Settings | null, (patch: Partial<Settings>) => Promise<Settings>] {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    void api.settings.get().then(setSettings)
    return api.on('settings:changed', setSettings)
  }, [])
  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.settings.set(patch)
    setSettings(next)
    return next
  }, [])
  return [settings, update]
}

export function useProfile(): UserProfile | null {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  useEffect(() => {
    void api.auth.profile().then(setProfile)
    return api.on('auth:changed', setProfile)
  }, [])
  return profile
}

/** Debounce a changing value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

import { describe, expect, it } from 'vitest'
import { parseWhen } from '../src/main/routines/parse'

// Wednesday 2026-11-04 10:15 local time.
const now = new Date(2026, 10, 4, 10, 15)
const at = (t: number | null): string => (t === null ? 'null' : new Date(t).toString().slice(0, 21))

describe('routine schedules (like Hermes cron)', () => {
  it('reads one-off and repeating schedules', () => {
    expect(parseWhen('in 30m').once).toBe(true)
    expect(parseWhen('in 30m').next(now)).toBe(now.getTime() + 30 * 60_000)
    expect(parseWhen('every 2h').next(now)).toBe(now.getTime() + 2 * 3_600_000)
    expect(at(parseWhen('daily 9:00').next(now))).toBe(at(new Date(2026, 10, 5, 9, 0).getTime()))
    expect(at(parseWhen('every day at 6pm').next(now))).toBe(at(new Date(2026, 10, 4, 18, 0).getTime()))
    expect(at(parseWhen('weekdays at 9am').next(new Date(2026, 10, 6, 12, 0)))).toBe(at(new Date(2026, 10, 9, 9, 0).getTime()))
    expect(at(parseWhen('every monday 18:30').next(now))).toBe(at(new Date(2026, 10, 9, 18, 30).getTime()))
    expect(at(parseWhen('2026-11-20 08:00').next(now))).toBe(at(new Date(2026, 10, 20, 8, 0).getTime()))
    expect(parseWhen('2026-01-01 08:00').next(now)).toBeNull()
  })

  it('reads cron expressions', () => {
    expect(at(parseWhen('0 9 * * 1-5').next(now))).toBe(at(new Date(2026, 10, 5, 9, 0).getTime()))
    expect(at(parseWhen('*/15 * * * *').next(now))).toBe(at(new Date(2026, 10, 4, 10, 30).getTime()))
  })

  it('refuses what it cannot read, and runs more often than every 5 minutes', () => {
    expect(() => parseWhen('sometime soon')).toThrow(/Can't read the schedule/)
    expect(() => parseWhen('every 1m')).toThrow(/every 5 minutes/)
  })
})

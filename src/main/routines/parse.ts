/**
 * When a routine runs, written the way people say it (as Hermes' cron accepts):
 * "in 30m", "every 2h", "daily 9:00", "weekdays at 9am", "every monday 18:30",
 * "2026-11-20 08:00", or a cron expression ("0 9 * * 1-5"). Times are local.
 */

export interface Schedule {
  /** Runs once, then stops. */
  once: boolean
  /** The first run after `after` (ms), or null when there is none (a time in the past). */
  next: (after: Date) => number | null
}

const UNITS: Record<string, number> = { m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000, h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000, d: 86_400_000, day: 86_400_000, days: 86_400_000 }
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const TIME = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/

function parseTime(text: string): { hour: number; minute: number } | null {
  const m = TIME.exec(text)
  if (!m) return null
  let hour = Number(m[1])
  const minute = Number(m[2] ?? 0)
  if (m[3] === 'pm' && hour < 12) hour += 12
  if (m[3] === 'am' && hour === 12) hour = 0
  return hour < 24 && minute < 60 ? { hour, minute } : null
}

/** The next time at hour:minute on one of `days` (0 = Sunday), after `after`. */
function nextAt(after: Date, hour: number, minute: number, days: number[]): number {
  const d = new Date(after)
  d.setSeconds(0, 0)
  d.setHours(hour, minute)
  for (let i = 0; i < 8; i++) {
    if (d.getTime() > after.getTime() && days.includes(d.getDay())) return d.getTime()
    d.setDate(d.getDate() + 1)
    d.setHours(hour, minute)
  }
  return d.getTime()
}

/** One cron field ("*", "1-5", "*\/15", "1,3,5") as the values it allows. */
function cronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!m) return null
    const from = m[1] === '*' ? min : Number(m[2])
    const to = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : from
    const step = Number(m[4] ?? 1)
    if (from < min || to > max || from > to || step < 1) return null
    for (let v = from; v <= to; v += step) out.add(v)
  }
  return out
}

function cron(expr: string): Schedule | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minutes, hours, dom, months, dow] = [cronField(fields[0], 0, 59), cronField(fields[1], 0, 23), cronField(fields[2], 1, 31), cronField(fields[3], 1, 12), cronField(fields[4].replace(/\b7\b/g, '0'), 0, 6)]
  if (!minutes || !hours || !dom || !months || !dow) return null
  const anyDom = fields[2] === '*'
  const anyDow = fields[4] === '*'
  return {
    once: false,
    next: (after) => {
      const d = new Date(after)
      d.setSeconds(0, 0)
      d.setMinutes(d.getMinutes() + 1)
      // At most a year ahead, a day or an hour at a time where nothing in it can match.
      for (let guard = 0; guard < 600_000; guard++) {
        // Like cron: with both day fields set, either one matching is enough.
        const dayOk = anyDom && anyDow ? true : anyDom ? dow.has(d.getDay()) : anyDow ? dom.has(d.getDate()) : dom.has(d.getDate()) || dow.has(d.getDay())
        if (!months.has(d.getMonth() + 1) || !dayOk) {
          d.setDate(d.getDate() + 1)
          d.setHours(0, 0)
          continue
        }
        if (!hours.has(d.getHours())) {
          d.setHours(d.getHours() + 1, 0)
          continue
        }
        if (minutes.has(d.getMinutes())) return d.getTime()
        d.setMinutes(d.getMinutes() + 1)
      }
      return null
    }
  }
}

/** Reads a schedule; throws with the forms it understands when it can't. */
export function parseWhen(input: string): Schedule {
  const when = input.trim().toLowerCase().replace(/\s+/g, ' ')
  let m: RegExpExecArray | null

  if ((m = /^in (\d+) ?([a-z]+)$/.exec(when)) && UNITS[m[2]]) {
    const ms = Number(m[1]) * UNITS[m[2]]
    // Counted from when the routine was made: `after` is that moment for its first run.
    return { once: true, next: (after) => after.getTime() + ms }
  }
  if ((m = /^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(when))) {
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime()
    return { once: true, next: (after) => (at > after.getTime() ? at : null) }
  }
  if ((m = /^every (\d+)? ?([a-z]+)$/.exec(when)) && UNITS[m[2]]) {
    const ms = Number(m[1] ?? 1) * UNITS[m[2]]
    if (ms < 5 * 60_000) throw new Error('Routines run at most every 5 minutes')
    return { once: false, next: (after) => after.getTime() + ms }
  }
  const daily = /^(?:every day|daily|each day)(?: at)? (.+)$/.exec(when)
  if (daily) {
    const t = parseTime(daily[1])
    if (t) return { once: false, next: (after) => nextAt(after, t.hour, t.minute, [0, 1, 2, 3, 4, 5, 6]) }
  }
  const weekly = /^(?:every )?(weekdays|weekends|(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*s?(?:, ?| and )?)+)(?: at)? (.+)$/.exec(when)
  if (weekly) {
    const t = parseTime(weekly[2])
    const days =
      weekly[1] === 'weekdays'
        ? [1, 2, 3, 4, 5]
        : weekly[1] === 'weekends'
          ? [0, 6]
          : weekly[1]
              .split(/, ?| and /)
              .map((d) => DAYS.indexOf(d.slice(0, 3)))
              .filter((d) => d >= 0)
    if (t && days.length) return { once: false, next: (after) => nextAt(after, t.hour, t.minute, days) }
  }
  const fromCron = cron(input)
  if (fromCron) return fromCron
  throw new Error(`Can't read the schedule "${input}". Use "in 30m", "every 2h", "daily 9:00", "weekdays at 9am", "every monday 18:30", "2026-11-20 08:00" or a cron expression like "0 9 * * 1-5".`)
}

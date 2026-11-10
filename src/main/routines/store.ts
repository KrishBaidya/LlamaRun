import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { Routine } from '@shared/types'
import { readJson, writeJson } from '../jsonFile'
import { userDataPath } from '../paths'
import { parseWhen } from './parse'

/** Routines (scheduled prompts), in userData/routines.json. The scheduler runs them; see scheduler.ts. */
class RoutineStore extends EventEmitter<{ changed: [Routine[]] }> {
  private items: Routine[] | null = null

  list(): Routine[] {
    this.items ??= readJson<Routine[]>(userDataPath('routines.json'), []).filter((r) => r?.id && typeof r.prompt === 'string')
    return this.items
  }

  get(id: string): Routine | undefined {
    return this.list().find((r) => r.id === id || r.id.startsWith(id))
  }

  add(prompt: string, when: string, model?: string): Routine {
    const text = prompt.trim()
    if (!text) throw new Error('A routine needs a prompt')
    const next = parseWhen(when).next(new Date())
    if (next === null) throw new Error(`"${when}" is in the past`)
    const routine: Routine = { id: randomUUID().slice(0, 8), prompt: text, when: when.trim(), next, createdAt: Date.now(), ...(model ? { model } : {}) }
    this.items = [...this.list(), routine]
    this.save()
    return routine
  }

  update(id: string, patch: Partial<Routine>): Routine {
    const routine = this.get(id)
    if (!routine) throw new Error(`No routine ${id}`)
    Object.assign(routine, patch)
    this.save()
    return routine
  }

  remove(id: string): boolean {
    const routine = this.get(id)
    if (!routine) return false
    this.items = this.list().filter((r) => r !== routine)
    this.save()
    return true
  }

  /** Pause, resume, remove, or run now (the scheduler picks it up at once). */
  act(id: string, action: 'pause' | 'resume' | 'remove' | 'run'): string {
    const routine = this.get(id)
    if (!routine) throw new Error(`No routine ${id}`)
    if (action === 'remove') {
      this.remove(id)
      return `Removed the routine "${routine.prompt}".`
    }
    if (action === 'pause') {
      this.update(id, { paused: true })
      return `Paused "${routine.prompt}".`
    }
    if (action === 'run') {
      this.update(id, { next: Date.now(), paused: false })
      return `Running "${routine.prompt}" now.`
    }
    const next = routine.next ?? parseWhen(routine.when).next(new Date())
    this.update(id, { paused: false, next: next !== null && next < Date.now() ? parseWhen(routine.when).next(new Date()) : next })
    return `Resumed "${routine.prompt}".`
  }

  private save(): void {
    writeJson(userDataPath('routines.json'), this.list())
    this.emit('changed', this.list())
  }
}

export const routineStore = new RoutineStore()

/** A routine for the model and the settings page: what, when, and what happened last. */
export function describeRoutine(r: Routine): string {
  const at = (t: number): string => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const state = r.paused ? 'paused' : r.next ? `next ${at(r.next)}` : 'done'
  const last = r.lastRun ? `; last ran ${at(r.lastRun)} (${r.lastStatus ?? 'done'})` : ''
  return `${r.id}: "${r.prompt}" (${r.when}; ${state}${last})`
}

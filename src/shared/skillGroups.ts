import type { SkillInfo } from './types'

/**
 * Skill packs installed as many folders (li-post, li-comment… or seo,
 * seo-audit, seo-page…) shown as one top-level entry. Skills sharing the
 * part of their name before the first dash form a group when there are at
 * least two; a skill named just that ("seo") leads it.
 */
export interface SkillGroup {
  kind: 'group'
  /** The shared prefix, e.g. "li". */
  key: string
  /** The skill named after the prefix, if there is one. */
  lead?: SkillInfo
  /** Every skill in the pack, the lead first. */
  skills: SkillInfo[]
}

export type SkillEntry = { kind: 'skill'; skill: SkillInfo } | SkillGroup

const prefixOf = (name: string): string => {
  const at = name.indexOf('-')
  return (at > 0 ? name.slice(0, at) : name).toLowerCase()
}

/** The skills as the Skills page lists them: groups and lone skills, in the order they first appear. */
export function groupSkills(skills: SkillInfo[]): SkillEntry[] {
  const byPrefix = new Map<string, SkillInfo[]>()
  for (const s of skills) {
    const key = prefixOf(s.name)
    byPrefix.set(key, [...(byPrefix.get(key) ?? []), s])
  }
  const out: SkillEntry[] = []
  const placed = new Set<string>()
  for (const s of skills) {
    const key = prefixOf(s.name)
    const members = byPrefix.get(key)!
    if (members.length < 2) {
      out.push({ kind: 'skill', skill: s })
      continue
    }
    if (placed.has(key)) continue
    placed.add(key)
    const lead = members.find((m) => m.name.toLowerCase() === key)
    out.push({ kind: 'group', key, ...(lead ? { lead } : {}), skills: lead ? [lead, ...members.filter((m) => m !== lead)] : members })
  }
  return out
}

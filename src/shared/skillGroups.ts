import type { SkillInfo } from './types'

/**
 * Skill packs installed as many folders shown as one top-level entry. Skills
 * from one Claude Code plugin (installed from bundles/<plugin>, plus its
 * <plugin>-cmd-* and <plugin>-agent-* skills) group under the plugin's name,
 * whatever their own names are. Other skills sharing the part of their name
 * before the first dash (li-post, li-comment… or seo, seo-audit…) form a group
 * when there are at least two; a skill named just that ("seo") leads it.
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

/** The Claude Code plugin a skill was installed from (its source is inside bundles/<plugin>/). */
const bundleOf = (s: SkillInfo): string | undefined => /[\\/]bundles[\\/]([^\\/]+)[\\/]/.exec(s.source ?? '')?.[1]

/** The skills as the Skills page lists them: groups and lone skills, in the order they first appear. */
export function groupSkills(skills: SkillInfo[]): SkillEntry[] {
  const bundles = new Set(skills.map(bundleOf).filter((b): b is string => Boolean(b)))
  // A plugin's skills, and the skills made from its commands and agents.
  const pluginOf = (s: SkillInfo): string | undefined =>
    bundleOf(s) ?? [...bundles].find((b) => s.id.startsWith(`${b}-cmd-`) || s.id.startsWith(`${b}-agent-`))
  const byPrefix = new Map<string, SkillInfo[]>()
  const keyOf = (s: SkillInfo): string => {
    const plugin = pluginOf(s)
    return plugin ? `plugin:${plugin}` : prefixOf(s.name)
  }
  for (const s of skills) {
    const key = keyOf(s)
    byPrefix.set(key, [...(byPrefix.get(key) ?? []), s])
  }
  const out: SkillEntry[] = []
  const placed = new Set<string>()
  for (const s of skills) {
    const key = keyOf(s)
    const members = byPrefix.get(key)!
    if (members.length < 2) {
      out.push({ kind: 'skill', skill: s })
      continue
    }
    if (placed.has(key)) continue
    placed.add(key)
    const name = key.startsWith('plugin:') ? key.slice('plugin:'.length) : key
    const lead = key.startsWith('plugin:') ? undefined : members.find((m) => m.name.toLowerCase() === key)
    out.push({ kind: 'group', key: name, ...(lead ? { lead } : {}), skills: lead ? [lead, ...members.filter((m) => m !== lead)] : members })
  }
  return out
}

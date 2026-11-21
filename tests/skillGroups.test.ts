import { describe, expect, it } from 'vitest'
import type { SkillInfo } from '../src/shared/types'
import { groupSkills } from '../src/shared/skillGroups'

const skill = (name: string, source?: string): SkillInfo =>
  ({ id: name, name, description: '', enabled: true, trusted: false, folder: name, location: 'claude', command: name, userInvocable: true, modelInvocable: true, scripts: [], files: [], hasRequirements: false, ...(source ? { source } : {}) }) as SkillInfo

describe('groupSkills', () => {
  it('puts skills sharing a prefix under one entry, led by the skill named after it', () => {
    const entries = groupSkills(['humanizer', 'li-post', 'seo-audit', 'li-comment', 'seo', 'linkedin-roast', 'pm-prd'].map(skill))
    expect(entries.map((e) => (e.kind === 'group' ? `${e.key}: ${e.skills.map((s) => s.name).join(', ')}` : e.skill.name))).toEqual([
      'humanizer',
      'li: li-post, li-comment',
      'seo: seo, seo-audit',
      'linkedin-roast',
      'pm-prd'
    ])
    const seo = entries.find((e) => e.kind === 'group' && e.key === 'seo')
    expect(seo?.kind === 'group' && seo.lead?.name).toBe('seo')
  })

  it("groups a Claude Code plugin's skills, commands and agents under the plugin, whatever their names", () => {
    const from = 'C:\\Users\\me\\AppData\\Roaming\\Llama Run\\bundles\\vercel\\skills'
    const entries = groupSkills([skill('auth', from), skill('humanizer'), skill('queues', from), skill('vercel-cmd-deploy'), skill('vercel-agent-ai-architect'), skill('workflow', from)])
    expect(entries.map((e) => (e.kind === 'group' ? `${e.key}: ${e.skills.map((s) => s.name).join(', ')}` : e.skill.name))).toEqual([
      'vercel: auth, queues, vercel-cmd-deploy, vercel-agent-ai-architect, workflow',
      'humanizer'
    ])
  })
})

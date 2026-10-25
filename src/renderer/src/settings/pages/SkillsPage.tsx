import { useEffect, useState, type DragEvent } from 'react'
import { AlertTriangle, Bot, Download, FileArchive, FolderOpen, Loader2, ShieldCheck, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SkillInfo } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api, useSettings } from '@/hooks/use-llamarun'
import { cn, errorMessage } from '@/lib/utils'
import { EmptyState, Page, PageHeader, SettingRow } from '../components'

const EXAMPLES: [string, string][] = [
  ['anthropics/skills', "Anthropic's example skills"],
  ['https://github.com/anthropics/skills/tree/main/skills/pdf', 'Just the PDF skill']
]

function SkillCard({ skill }: { skill: SkillInfo }) {
  return (
    <Card className={cn('gap-3 py-4', !skill.enabled && 'opacity-70')}>
      <CardHeader className="px-4">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-sm">{skill.name}</CardTitle>
            <CardDescription className="mt-0.5 line-clamp-3 text-xs">{skill.description || 'No description'}</CardDescription>
          </div>
          <Switch
            checked={skill.enabled}
            aria-label={`Use ${skill.name}`}
            onCheckedChange={(v) => void api.skills.setEnabled(skill.id, v)}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex flex-wrap gap-1.5">
          {skill.scripts.length > 0 && (
            <Badge variant="secondary" className="px-1.5 py-0 text-2xs font-normal">
              {skill.scripts.length} Python script{skill.scripts.length === 1 ? '' : 's'}
            </Badge>
          )}
          {skill.location !== 'shared' && (
            <Badge variant="outline" className="px-1.5 py-0 text-2xs font-normal">
              {skill.location === 'claude' ? 'From Claude Code' : 'Llama Run only'}
            </Badge>
          )}
          <Badge variant="outline" className="px-1.5 py-0 text-2xs font-normal">
            {skill.files.length} file{skill.files.length === 1 ? '' : 's'}
          </Badge>
          {skill.trusted && (
            <Badge variant="outline" className="gap-1 px-1.5 py-0 text-2xs font-normal">
              <ShieldCheck className="size-3" /> Scripts run without asking
            </Badge>
          )}
        </div>
        {skill.requirementsError && (
          <p className="flex items-start gap-1.5 text-2xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-px size-3 shrink-0" /> Some requirements didn't install: {skill.requirementsError.split('\n')[0]}
          </p>
        )}
        {skill.source && (
          <p className="truncate text-2xs text-muted-foreground" title={skill.source}>
            From {skill.source}
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void api.skills.openFolder(skill.id)}>
            <FolderOpen /> Open folder
          </Button>
          {skill.trusted && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void api.skills.setTrusted(skill.id, false)}>
              <ShieldCheck /> Ask before scripts
            </Button>
          )}
          {skill.location !== 'claude' && (
            <Button
              size="sm"
              variant="ghost"
              className="ms-auto h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => {
                const shared = skill.location === 'shared' ? ' It is in the shared skills folder, so other AI apps lose it too.' : ''
                if (window.confirm(`Remove the ${skill.name} skill?${shared}`)) void api.skills.remove(skill.id)
              }}
            >
              <Trash2 /> Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Skills are folders with a SKILL.md, as in Claude: install them from a ZIP or
 * folder, from a link (GitHub, GitLab, any git repo, a .zip or a SKILL.md), or
 * let the AI read the README and set them up, asking before each command.
 */
export function SkillsPage() {
  const [settings, update] = useSettings()
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void api.skills.list().then(setSkills)
    return api.on('skills:changed', setSkills)
  }, [])

  const install = async (from = source): Promise<void> => {
    if (!from.trim() || busy) return
    setBusy(true)
    try {
      const added = await api.skills.install(from)
      toast.success(added.length === 1 ? `Installed ${added[0].name}` : `Installed ${added.length} skills`, {
        description: added.length > 1 ? added.map((s) => s.name).join(', ') : added[0]?.description
      })
      setSource('')
    } catch (err) {
      toast.error("Couldn't install that", {
        description: errorMessage(err),
        action: from.trim() && !/^[a-z]:\\|^\//i.test(from) ? { label: 'Install with AI', onClick: () => void api.skills.installWithAi(from) } : undefined
      })
    } finally {
      setBusy(false)
    }
  }

  const pick = async (kind: 'zip' | 'folder'): Promise<void> => {
    const path = await api.skills.pick(kind)
    if (path) await install(path)
  }

  const onDrop = (e: DragEvent): void => {
    setDragging(false)
    const file = e.dataTransfer.files[0]
    const path = file ? api.files.pathFor(file) : e.dataTransfer.getData('text/plain')
    if (!path) return
    e.preventDefault()
    void install(path)
  }

  const on = settings?.skillsEnabled !== false
  return (
    <Page wide>
      <PageHeader
        title="Skills"
        description="Folders of instructions and Python scripts that teach your AI new tasks, in the open SKILL.md format. They live in the shared skills folder (~/.agents/skills) that Codex, Cursor and other agents read too, and your Claude Code skills (~/.claude/skills) show up here as well."
        actions={
          <Button variant="outline" size="sm" onClick={() => void api.skills.openFolder()}>
            <FolderOpen /> Skills folder
          </Button>
        }
      />

      <Card
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(dragging && 'border-primary bg-primary/5')}
      >
        <CardHeader>
          <CardTitle>Add a skill</CardTitle>
          <CardDescription>
            Paste a link (GitHub, GitLab, Bitbucket, any git repository, a .zip or a SKILL.md), or drop a ZIP or folder here.
            If it needs setting up, <b>Install with AI</b> reads its README and follows the steps, asking before every command.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Input
              value={source}
              placeholder="https://github.com/owner/repo  or  owner/repo"
              onChange={(e) => setSource(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void install()}
              className="min-w-64 flex-1"
            />
            <Button onClick={() => void install()} disabled={!source.trim() || busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Download />} Install
            </Button>
            <Button variant="outline" onClick={() => void api.skills.installWithAi(source)} disabled={!source.trim() || busy}>
              <Wand2 /> Install with AI
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void pick('zip')} disabled={busy}>
              <FileArchive /> Upload ZIP
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void pick('folder')} disabled={busy}>
              <FolderOpen /> Choose folder
            </Button>
            <span className="ms-2">Try:</span>
            {EXAMPLES.map(([value, label]) => (
              <button key={value} className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => setSource(value)}>
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y py-0">
          <SettingRow title="Use skills" description="Offer installed skills to your models. When one fits your request, the model loads it and can run its scripts (you're asked first).">
            <Switch checked={on} onCheckedChange={(v) => void update({ skillsEnabled: v })} />
          </SettingRow>
          {(settings?.allowedCommands?.length ?? 0) > 0 && (
            <SettingRow
              title="Always-allowed commands"
              description={settings!.allowedCommands.slice(0, 3).join(' · ') + (settings!.allowedCommands.length > 3 ? ' …' : '')}
            >
              <Button variant="outline" size="sm" onClick={() => void update({ allowedCommands: [] })}>
                Ask again for all
              </Button>
            </SettingRow>
          )}
        </CardContent>
      </Card>

      {skills && !skills.length ? (
        <EmptyState icon={<Bot />} title="No skills yet">
          Install Anthropic's example skills to see how they work: PDF and Word tools, spreadsheets, slide decks and more.
        </EmptyState>
      ) : (
        <div className="@container">
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
            {skills?.map((s) => <SkillCard key={s.id} skill={s} />)}
          </div>
        </div>
      )}
    </Page>
  )
}

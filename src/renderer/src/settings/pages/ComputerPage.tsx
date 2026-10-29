import { useState } from 'react'
import { Ban, MousePointerClick, Plus, ShieldCheck, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useSettings } from '@/hooks/use-llamarun'
import { EmptyState, Page, PageHeader, SettingRow } from '../components'

/** "notepad.exe", "Notepad" -> "notepad", the way the main process matches apps. */
const appKey = (app: string): string =>
  app
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '')

function AppList({ apps, onRemove, empty }: { apps: string[]; onRemove: (app: string) => void; empty: string }) {
  if (!apps.length) return <div className="py-2 text-2xs text-muted-foreground">{empty}</div>
  return (
    <div className="flex flex-wrap gap-1.5 py-1">
      {apps.map((app) => (
        <Badge key={app} variant="secondary" className="gap-1 pr-1 font-normal">
          {app}
          <button type="button" className="rounded-sm opacity-60 hover:opacity-100" aria-label={`Remove ${app}`} onClick={() => onRemove(app)}>
            <X className="size-3" />
          </button>
        </Badge>
      ))}
    </div>
  )
}

/** Computer use: the AI operates apps on this PC through Cua Driver. */
export function ComputerPage() {
  const [settings, update] = useSettings()
  const [blockDraft, setBlockDraft] = useState('')
  const on = settings?.computerUse === true
  const allowed = settings?.computerAllowedApps ?? []
  const blocked = settings?.computerBlockedApps ?? []

  const block = (): void => {
    const key = appKey(blockDraft)
    if (!key) return
    if (!blocked.includes(key)) void update({ computerBlockedApps: [...blocked, key] })
    setBlockDraft('')
  }

  return (
    <Page>
      <PageHeader
        title="Computer use"
        description="Let the AI open apps, click, type and press keys on this PC to get things done. It works in the background, so you can keep using your mouse and keyboard."
      />
      <Card>
        <CardContent className="divide-y py-0">
          <SettingRow
            title="Let the AI use this computer"
            description="Only in messages you type. It asks before controlling each app, and a card at the top of the screen shows what it's using."
          >
            <Switch checked={on} onCheckedChange={(v) => void update({ computerUse: v })} />
          </SettingRow>
          <SettingRow
            title="Send screenshots to the model"
            description="Local models that can see images also get a screenshot of the window. Slower, but works in apps that don't describe their buttons."
          >
            <Switch
              checked={settings?.computerScreenshots !== false}
              disabled={!on}
              onCheckedChange={(v) => void update({ computerScreenshots: v })}
            />
          </SettingRow>
          <SettingRow title="Steps per reply" description="Most actions in one reply before it pauses and asks you to continue.">
            <Input
              type="number"
              min={10}
              max={500}
              className="w-20"
              disabled={!on}
              key={settings?.computerMaxSteps ?? 50}
              defaultValue={settings?.computerMaxSteps ?? 50}
              // Saved on blur: clamping while typing would turn "5" (of "50") into 10.
              onBlur={(e) => {
                const n = Math.round(Number(e.target.value))
                const next = Number.isFinite(n) && n > 0 ? Math.min(500, Math.max(10, n)) : 50
                if (next !== settings?.computerMaxSteps) void update({ computerMaxSteps: next })
                else e.target.value = String(next)
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </SettingRow>
          <SettingRow title="Stop it" description="Click the card at the top of the screen, press Ctrl+Alt+Esc, or press stop in the chat.">
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-2xs">Ctrl+Alt+Esc</kbd>
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> Always allowed
          </CardTitle>
          <CardDescription>Apps you chose “Always allow” for. The AI controls these without asking first.</CardDescription>
        </CardHeader>
        <CardContent>
          <AppList
            apps={allowed}
            empty="None yet. The AI asks before it controls an app."
            onRemove={(app) => void update({ computerAllowedApps: allowed.filter((a) => a !== app) })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="size-4" /> Never control
          </CardTitle>
          <CardDescription>The AI refuses to touch these apps, for example your password manager or banking app.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              value={blockDraft}
              placeholder="App name, e.g. KeePass or 1Password"
              onChange={(e) => setBlockDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && block()}
            />
            <Button onClick={block} disabled={!blockDraft.trim()}>
              <Plus /> Add
            </Button>
          </div>
          {blocked.length ? (
            <AppList apps={blocked} empty="" onRemove={(app) => void update({ computerBlockedApps: blocked.filter((a) => a !== app) })} />
          ) : (
            <EmptyState icon={<MousePointerClick />} title="No blocked apps">
              Add apps the AI should never open or control.
            </EmptyState>
          )}
        </CardContent>
      </Card>
    </Page>
  )
}

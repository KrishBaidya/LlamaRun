import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Boxes, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { Settings } from '@shared/types'
import { findModel, useModelCatalog } from '@/components/chat/ModelPicker'
import { CapabilityIcons, ProviderIcon, modelSummary } from '@/components/models/model-meta'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { api, useSettings } from '@/hooks/use-llamarun'
import { errorMessage } from '@/lib/utils'
import heart from '@/assets/heart.gif'
import { Page, PageHeader, SettingRow } from '../components'
import { HotkeyRecorder, prettyAccelerator } from '../HotkeyRecorder'

type Draft = Pick<
  Settings,
  'appOpacity' | 'startupEnabled' | 'hotkey' | 'windowWidthPct' | 'windowHeightPct' | 'overlayNewChatAfterMinutes'
>

const OVERLAY_TIMEOUTS: [number, string][] = [
  [5, 'After 5 minutes'],
  [15, 'After 15 minutes'],
  [30, 'After 30 minutes'],
  [60, 'After 1 hour'],
  [0, 'Never (always continue)']
]

function pick(s: Settings): Draft {
  const { appOpacity, startupEnabled, hotkey, windowWidthPct, windowHeightPct, overlayNewChatAfterMinutes } = s
  return { appOpacity, startupEnabled, hotkey, windowWidthPct, windowHeightPct, overlayNewChatAfterMinutes }
}

export function HomePage() {
  const [settings, update] = useSettings()
  const [draft, setDraft] = useState<Draft | null>(null)
  const catalog = useModelCatalog()
  const navigate = useNavigate()
  const [activeHotkey, setActiveHotkey] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    void api.settings.hotkeyStatus().then((s) => setActiveHotkey(s.active))
  }, [settings])
  useEffect(() => {
    if (settings && !draft) setDraft(pick(settings))
  }, [settings, draft])

  const dirty = useMemo(
    () => !!settings && !!draft && JSON.stringify(pick(settings)) !== JSON.stringify(draft),
    [settings, draft]
  )

  if (!draft || !settings) return null
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft({ ...draft, [key]: value })

  const save = async (): Promise<void> => {
    try {
      const next = await update(draft)
      setDraft(pick(next))
      const status = await api.settings.hotkeyStatus()
      if (status.active !== status.requested) {
        toast.warning(
          status.active
            ? `${status.requested} is taken; using ${status.active} instead.`
            : `Could not register ${status.requested}. Try another shortcut.`
        )
      } else toast.success('Settings saved')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const reset = async (): Promise<void> => {
    const next = await api.settings.reset()
    setDraft(pick(next))
    toast.success('Settings reset to defaults')
  }

  const current = findModel(catalog, settings.selectedModel)

  return (
    <Page>
      <PageHeader
        title="General"
        description="Default model, shortcut, and how Llama Run looks and starts."
        actions={
          <>
            <Button variant="outline" onClick={() => void reset()}>
              <RotateCcw /> Reset to Defaults
            </Button>
            <Button onClick={() => void save()} disabled={!dirty}>
              <Save /> Save Settings
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Default model</CardTitle>
          <CardDescription>Used for new chats. Cloud models run through your LlamaRun account; Ollama models run locally.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          {current ? (
            <>
              <ProviderIcon provider={current.provider} className="size-10" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{current.name}</span>
                  <CapabilityIcons capabilities={current.capabilities} />
                </div>
                <div className="truncate text-xs text-muted-foreground">{modelSummary(current) || current.id}</div>
              </div>
            </>
          ) : (
            <div className="min-w-0 flex-1 text-sm text-muted-foreground">
              {settings.selectedModel
                ? catalog
                  ? `${settings.selectedModel} isn’t available right now.`
                  : settings.selectedModel
                : 'No default model selected.'}
            </div>
          )}
          <Button variant="outline" onClick={() => void navigate('/models')}>
            <Boxes /> Browse models
          </Button>
        </CardContent>
      </Card>

      <Card className="gap-0">
        <CardHeader className="pb-2">
          <CardTitle>Appearance &amp; Behavior</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingRow
            title="Global shortcut"
            description={
              activeHotkey !== undefined && settings.hotkey !== activeHotkey ? (
                <span className="text-amber-600 dark:text-amber-400">
                  {activeHotkey
                    ? `${prettyAccelerator(settings.hotkey).join('+')} is used by another app, so ${prettyAccelerator(activeHotkey).join('+')} is active instead.`
                    : 'This shortcut could not be registered. Choose another one.'}
                </span>
              ) : (
                'Shows or hides the Llama Run overlay from anywhere.'
              )
            }
          >
            <HotkeyRecorder value={draft.hotkey} onChange={(v) => set('hotkey', v)} />
          </SettingRow>
          <Separator />
          <SettingRow
            title="Overlay conversation"
            description="The overlay continues your last chat. Start a fresh one after this much inactivity."
          >
            <Select
              value={String(draft.overlayNewChatAfterMinutes)}
              onValueChange={(v) => set('overlayNewChatAfterMinutes', Number(v))}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OVERLAY_TIMEOUTS.map(([v, label]) => (
                  <SelectItem key={v} value={String(v)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <Separator />
          <SettingRow title="Animation Opacity" description="Strength of the gradient shown while a response is generating.">
            <Slider
              className="w-48"
              min={0}
              max={100}
              step={1}
              value={[draft.appOpacity]}
              onValueChange={([v]) => set('appOpacity', v)}
            />
            <span className="w-10 text-right text-sm tabular-nums">{draft.appOpacity}%</span>
          </SettingRow>
          <Separator />
          <SettingRow title="Overlay size" description="Width and height as a percentage of the screen.">
            <div className="flex flex-col gap-3">
              {(['windowWidthPct', 'windowHeightPct'] as const).map((key) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-12 text-xs text-muted-foreground">{key === 'windowWidthPct' ? 'Width' : 'Height'}</span>
                  <Slider className="w-36" min={25} max={90} step={1} value={[draft[key]]} onValueChange={([v]) => set(key, v)} />
                  <span className="w-10 text-right text-sm tabular-nums">{draft[key]}%</span>
                </div>
              ))}
            </div>
          </SettingRow>
          <Separator />
          <div className="flex items-center gap-3 py-4">
            <Checkbox
              id="startup"
              checked={draft.startupEnabled}
              onCheckedChange={(v) => set('startupEnabled', v === true)}
            />
            <Label htmlFor="startup">Launch Llama Run automatically when {window.llamarun.platform === 'darwin' ? 'you log in' : 'Windows starts'}</Label>
          </div>
        </CardContent>
      </Card>

      <footer className="flex items-center justify-center gap-1.5 pt-2 text-sm text-muted-foreground">
        Made with <img src={heart} alt="love" className="size-5" /> by
        <button className="text-primary hover:underline" onClick={() => void api.app.openExternal('https://github.com/krishbaidya')}>
          Krish Baidya
        </button>
      </footer>
    </Page>
  )
}

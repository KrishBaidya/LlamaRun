import { useEffect, useState, type ComponentType } from 'react'
import { AudioLines, FileText, Gauge, Image, Type, Video } from 'lucide-react'
import { thinkingChoices, thinkingLabel } from '@shared/thinking'
import type { ModelContextInfo, ModelInfo, ModelModality, ThinkingChoice } from '@shared/types'
import { formatTokens } from '@/components/chat/ContextRing'
import { useModelCatalog } from '@/components/chat/ModelPicker'
import { deprecationNote, featureLabel, formatMonth } from '@/components/models/model-meta'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, useSettings } from '@/hooks/use-llamarun'

const SOURCE: Record<ModelContextInfo['source'], string> = {
  model: 'reported by the model',
  override: 'your override',
  fallback: "the model doesn't report one; using a safe default"
}

const MODALITY: Record<ModelModality, { label: string; icon: ComponentType<{ className?: string }> }> = {
  text: { label: 'Text', icon: Type },
  image: { label: 'Images', icon: Image },
  video: { label: 'Video', icon: Video },
  audio: { label: 'Audio', icon: AudioLines },
  pdf: { label: 'PDF', icon: FileText }
}

/** Select value for "use the model's own default". */
const DEFAULT = 'default'

function Modalities({ items }: { items: ModelModality[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((m) => {
        const { label, icon: Icon } = MODALITY[m]
        return (
          <span key={m} className="inline-flex h-5 items-center gap-1 rounded-md bg-muted px-1.5 text-2xs text-muted-foreground">
            <Icon className="size-3" /> {label}
          </span>
        )
      })}
    </span>
  )
}

/** The model card: what goes in and out, limits, the provider's features, and dates. */
function About({ model }: { model: ModelInfo }) {
  const catalog = useModelCatalog()
  const replacement = model.deprecated?.replacement
  const replacementName = replacement ? catalog?.groups.flatMap((g) => g.models).find((m) => m.id === replacement)?.name : undefined
  const retiring = deprecationNote(model, replacementName)
  const dates = [model.updated && `Updated ${formatMonth(model.updated)}`, model.knowledgeCutoff && `knowledge to ${formatMonth(model.knowledgeCutoff)}`].filter(Boolean)
  if (!model.inputs && !model.features && !retiring) return null
  return (
    <div className="grid gap-2 text-xs">
      {retiring && <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-destructive">{retiring}</p>}
      {model.inputs?.length ? (
        <div className="grid gap-1">
          <span className="text-muted-foreground">Reads</span>
          <Modalities items={model.inputs} />
        </div>
      ) : null}
      {model.outputs?.length ? (
        <div className="grid gap-1">
          <span className="text-muted-foreground">Writes</span>
          <Modalities items={model.outputs} />
        </div>
      ) : null}
      {(model.contextWindow || model.maxOutputTokens) && (
        <p className="text-muted-foreground">
          {[model.contextWindow && `${formatTokens(model.contextWindow)} context`, model.maxOutputTokens && `${formatTokens(model.maxOutputTokens)} max output`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {model.features?.length ? (
        <div className="grid gap-1">
          <span className="text-muted-foreground">Supports</span>
          <span className="flex flex-wrap gap-1">
            {model.features.map((f) => (
              <span key={f} className="inline-flex h-5 items-center rounded-md border border-border/70 px-1.5 text-2xs text-muted-foreground">
                {featureLabel(f)}
              </span>
            ))}
          </span>
        </div>
      ) : null}
      {dates.length > 0 && <p className="text-2xs text-muted-foreground">{dates.join(', ')}</p>}
    </div>
  )
}

/**
 * One model's settings: its model card, how hard it thinks by default (a chat
 * can choose its own in the chat box), and its context window and when to
 * auto-compact.
 */
export function ModelSettingsPopover({ model }: { model: ModelInfo }) {
  const [settings, update] = useSettings()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<ModelContextInfo | null>(null)
  const override = settings?.modelContext?.[model.id]
  const [tokens, setTokens] = useState('')
  const [percent, setPercent] = useState('')
  const [thinking, setThinking] = useState<string>(DEFAULT)
  const choices = thinkingChoices(model)

  useEffect(() => {
    if (!open) return
    void api.models.context([model.id]).then(([i]) => setInfo(i ?? null))
    setTokens(override?.contextTokens ? String(override.contextTokens) : '')
    setPercent(override?.compactAtPercent ? String(override.compactAtPercent) : '')
    setThinking(override?.thinking ?? DEFAULT)
  }, [open, model.id, override?.contextTokens, override?.compactAtPercent, override?.thinking])

  const save = (): void => {
    const next = { ...(settings?.modelContext ?? {}) }
    const t = Number(tokens)
    const p = Number(percent)
    const entry = {
      ...(t > 0 ? { contextTokens: Math.round(t) } : {}),
      ...(p >= 50 && p <= 95 ? { compactAtPercent: Math.round(p) } : {}),
      ...(thinking !== DEFAULT && choices.includes(thinking as ThinkingChoice) ? { thinking: thinking as ThinkingChoice } : {})
    }
    if (Object.keys(entry).length) next[model.id] = entry
    else delete next[model.id]
    void update({ modelContext: next }).then(() => setOpen(false))
  }

  const reset = (): void => {
    const next = { ...(settings?.modelContext ?? {}) }
    delete next[model.id]
    void update({ modelContext: next }).then(() => setOpen(false))
  }

  const ownDefault = model.thinking?.default ? ` (${thinkingLabel(model.thinking.default)})` : ''

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-2xs text-muted-foreground"
          title="Model settings"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Gauge className="size-3" />
          {override?.contextTokens ? `${formatTokens(override.contextTokens)}*` : model.contextWindow ? formatTokens(model.contextWindow) : 'ctx'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[80vh] w-80 overflow-y-auto text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-3">
          <div>
            <div className="font-medium">{model.name}</div>
            {model.description && <p className="text-xs text-muted-foreground">{model.description}</p>}
          </div>
          <About model={model} />
          {choices.length > 0 && (
            <div className="grid gap-1.5">
              <Label className="text-xs">Thinking</Label>
              <Select value={thinking} onValueChange={setThinking}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT}>Model default{ownDefault}</SelectItem>
                  {choices.map((c) => (
                    <SelectItem key={c} value={c}>
                      {thinkingLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-2xs text-muted-foreground">
                {model.cloud ? 'Higher thinks longer before answering: better on hard tasks, slower and more output tokens.' : 'On lets the model reason before it answers; slower on this computer.'} A
                chat can choose its own in the chat box.
              </p>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`ctx-${model.id}`} className="text-xs">
              Context window (tokens)
            </Label>
            {info && (
              <p className="text-2xs text-muted-foreground">
                Uses {formatTokens(info.tokens)} tokens ({SOURCE[info.source]})
                {info.reported && info.reported !== info.tokens ? `; the model supports ${formatTokens(info.reported)}` : ''}. Compacts at{' '}
                {info.compactAtPercent}%.
              </p>
            )}
            <Input
              id={`ctx-${model.id}`}
              inputMode="numeric"
              placeholder={info?.reported ? String(info.reported) : 'e.g. 32768'}
              value={tokens}
              onChange={(e) => setTokens(e.target.value.replace(/\D/g, ''))}
            />
            {!model.cloud && <p className="text-2xs text-muted-foreground">Ollama loads the model with this much context; bigger needs more memory.</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`pct-${model.id}`} className="text-xs">
              Compact at (%)
            </Label>
            <Input
              id={`pct-${model.id}`}
              inputMode="numeric"
              placeholder={String(settings?.autoCompactPercent ?? 80)}
              value={percent}
              onChange={(e) => setPercent(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div className="flex justify-end gap-2">
            {override && (
              <Button variant="ghost" size="sm" onClick={reset}>
                Reset
              </Button>
            )}
            <Button size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

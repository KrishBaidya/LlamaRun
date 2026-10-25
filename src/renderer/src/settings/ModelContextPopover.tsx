import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import type { ModelContextInfo, ModelInfo } from '@shared/types'
import { formatTokens } from '@/components/chat/ContextRing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, useSettings } from '@/hooks/use-llamarun'

const SOURCE: Record<ModelContextInfo['source'], string> = {
  model: 'reported by the model',
  override: 'your override',
  fallback: "the model doesn't report one; using a safe default"
}

/**
 * One model's context window: what it reports, and the user's override for
 * that model alone (window size and when to auto-compact).
 */
export function ModelContextPopover({ model }: { model: ModelInfo }) {
  const [settings, update] = useSettings()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<ModelContextInfo | null>(null)
  const override = settings?.modelContext?.[model.id]
  const [tokens, setTokens] = useState('')
  const [percent, setPercent] = useState('')

  useEffect(() => {
    if (!open) return
    void api.models.context([model.id]).then(([i]) => setInfo(i ?? null))
    setTokens(override?.contextTokens ? String(override.contextTokens) : '')
    setPercent(override?.compactAtPercent ? String(override.compactAtPercent) : '')
  }, [open, model.id, override?.contextTokens, override?.compactAtPercent])

  const save = (): void => {
    const next = { ...(settings?.modelContext ?? {}) }
    const t = Number(tokens)
    const p = Number(percent)
    const entry = { ...(t > 0 ? { contextTokens: Math.round(t) } : {}), ...(p >= 50 && p <= 95 ? { compactAtPercent: Math.round(p) } : {}) }
    if (Object.keys(entry).length) next[model.id] = entry
    else delete next[model.id]
    void update({ modelContext: next }).then(() => setOpen(false))
  }

  const reset = (): void => {
    const next = { ...(settings?.modelContext ?? {}) }
    delete next[model.id]
    void update({ modelContext: next }).then(() => setOpen(false))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-2xs text-muted-foreground"
          title="Context window"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Gauge className="size-3" />
          {override?.contextTokens ? `${formatTokens(override.contextTokens)}*` : model.contextWindow ? formatTokens(model.contextWindow) : 'ctx'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-3">
          <div>
            <div className="font-medium">{model.name}</div>
            {info && (
              <p className="text-xs text-muted-foreground">
                Uses {formatTokens(info.tokens)} tokens ({SOURCE[info.source]})
                {info.reported && info.reported !== info.tokens ? `; the model supports ${formatTokens(info.reported)}` : ''}. Compacts at{' '}
                {info.compactAtPercent}%.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`ctx-${model.id}`} className="text-xs">
              Context window (tokens)
            </Label>
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
                Use model's own
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

import { Brain, Check, ChevronDown } from 'lucide-react'
import { fitThinking, thinkingChoices, thinkingLabel } from '@shared/thinking'
import type { ThinkingChoice } from '@shared/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useSettings } from '@/hooks/use-llamarun'
import { cn } from '@/lib/utils'
import { findModel, useModelCatalog } from './ModelPicker'

/**
 * How hard the model thinks in this chat, next to the model picker. Shows the
 * level in effect: the chat's own choice, else the model's default from Model
 * settings, else the model's own default. Hidden for models that can't think.
 */
export function ThinkingPicker({
  model,
  value,
  onChange,
  disabled
}: {
  model: string
  /** The chat's own choice; undefined uses the model's default. */
  value: ThinkingChoice | undefined
  onChange: (thinking: ThinkingChoice | undefined) => void
  disabled?: boolean
}) {
  const catalog = useModelCatalog()
  const [settings] = useSettings()
  const info = findModel(catalog, model)
  const choices = thinkingChoices(info)
  if (!choices.length) return null

  const chosen = fitThinking(info, value)
  const saved = fitThinking(info, settings?.modelContext?.[model]?.thinking)
  const fallback = saved ?? info?.thinking?.default
  const shown = chosen ?? fallback
  const defaultLabel = fallback ? `Default (${thinkingLabel(fallback)})` : 'Default'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="ghost"
          size="sm"
          title="How hard the model thinks"
          className="gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
        >
          <Brain className="size-3.5" />
          <span>{shown ? thinkingLabel(shown) : 'Thinking'}</span>
          {!chosen && <span className="opacity-60">default</span>}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">Thinking for this chat</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(undefined)}>
          <Check className={cn('size-3.5', chosen && 'invisible')} />
          {defaultLabel}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {choices.map((c) => (
          <DropdownMenuItem key={c} onSelect={() => onChange(c)}>
            <Check className={cn('size-3.5', chosen !== c && 'invisible')} />
            {thinkingLabel(c)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

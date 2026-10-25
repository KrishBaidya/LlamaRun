import { useEffect, useState } from 'react'
import type { ContextUsage } from '@shared/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/hooks/use-llamarun'
import { cn } from '@/lib/utils'

export const formatTokens = (n: number): string =>
  n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)

const SOURCE: Record<ContextUsage['source'], string> = {
  model: "the model's own size",
  override: 'your override for this model',
  fallback: "the model doesn't report one, so 8K is assumed"
}

/**
 * How full the chat's model's context window is. Each model has its own
 * window; clicking compacts the chat now (like /compact).
 */
export function ContextRing({
  chatId,
  model,
  version,
  onCompact,
  className
}: {
  chatId: string | null
  model: string
  /** Changes whenever the conversation does, to re-measure. */
  version: string
  onCompact?: () => void
  className?: string
}) {
  const [usage, setUsage] = useState<ContextUsage | null>(null)
  useEffect(() => {
    if (!model) return
    let alive = true
    const t = setTimeout(() => {
      void api.chats
        .contextUsage(chatId, model)
        .then((u) => alive && setUsage(u))
        .catch(() => {})
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [chatId, model, version])

  if (!usage) return null
  const r = 7
  const c = 2 * Math.PI * r
  const near = usage.percent >= usage.compactAtPercent - 10
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Context ${usage.percent}% full`}
          onClick={chatId ? onCompact : undefined}
          className={cn('flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent', className)}
        >
          <svg viewBox="0 0 18 18" className="size-4 -rotate-90">
            <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth="2.2" />
            <circle
              cx="9"
              cy="9"
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - Math.max(0.02, usage.percent / 100))}
              className={near ? 'text-amber-500' : 'text-primary'}
            />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs">
        <p className="font-medium">
          {usage.percent}% of context used · {formatTokens(usage.used)} / {formatTokens(usage.tokens)}
        </p>
        <p className="text-muted-foreground">Window: {SOURCE[usage.source]}. Auto-compacts at {usage.compactAtPercent}%.</p>
        {chatId && <p className="text-muted-foreground">Click to compact now.</p>}
      </TooltipContent>
    </Tooltip>
  )
}

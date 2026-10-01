import type { ComponentType } from 'react'
import { Brain, Cpu, Eye, Globe, Sparkles, Wrench, Zap, Bot } from 'lucide-react'
import type { ModelCapability, ModelInfo, ModelProvider } from '@shared/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const PROVIDER_ICONS: Record<ModelProvider, ComponentType<{ className?: string }>> = {
  gemini: Sparkles,
  openai: Bot,
  ollama: Cpu
}

/** Tinted square with the provider's icon. */
export function ProviderIcon({ provider, className }: { provider: ModelProvider; className?: string }) {
  const Icon = PROVIDER_ICONS[provider] ?? Bot
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg [&>svg]:size-4',
        provider === 'gemini' && 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
        provider === 'openai' && 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
        provider === 'ollama' && 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
        className
      )}
    >
      <Icon />
    </span>
  )
}

export const CAPABILITIES: Record<ModelCapability, { label: string; hint: string; icon: ComponentType<{ className?: string }> }> = {
  tools: { label: 'Tools', hint: 'Can call MCP tools', icon: Wrench },
  vision: { label: 'Vision', hint: 'Understands images', icon: Eye },
  thinking: { label: 'Reasoning', hint: 'Thinks step by step before answering', icon: Brain },
  fast: { label: 'Fast', hint: 'Low latency', icon: Zap },
  search: { label: 'Search', hint: 'Can search the web for fresh information', icon: Globe }
}

/** Small capability icons with tooltips; `labels` shows text chips instead. */
export function CapabilityIcons({
  capabilities,
  labels = false,
  className
}: {
  capabilities?: ModelCapability[]
  labels?: boolean
  className?: string
}) {
  if (!capabilities?.length) return null
  return (
    <span className={cn('flex flex-wrap items-center gap-1', className)}>
      {capabilities.map((cap) => {
        // Skip values a newer catalog might send before this build knows them.
        if (!CAPABILITIES[cap]) return null
        const { label, hint, icon: Icon } = CAPABILITIES[cap]
        return (
          <Tooltip key={cap}>
            <TooltipTrigger asChild>
              {labels ? (
                <span className="inline-flex h-5 items-center gap-1 rounded-md bg-muted px-1.5 text-2xs font-medium text-muted-foreground">
                  <Icon className="size-3" /> {label}
                </span>
              ) : (
                <span className="flex size-5 items-center justify-center rounded text-muted-foreground" aria-label={label}>
                  <Icon className="size-3.5" />
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        )
      })}
    </span>
  )
}

/** 1048576 → "1M", 128000 → "128K". */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

/** "Pro" / "Preview" tags for cloud models; renders nothing for plain free, stable models. */
export function ModelBadges({ model, className }: { model: ModelInfo; className?: string }) {
  const pro = model.tier === 'pro'
  const preview = model.status === 'preview'
  const dev = model.status === 'dev'
  if (!pro && !preview && !dev) return null
  const chip = 'inline-flex h-4.5 shrink-0 items-center rounded px-1 text-2xs leading-none font-medium'
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)}>
      {pro && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(chip, 'bg-violet-500/12 text-violet-600 dark:text-violet-400')}>Pro</span>
          </TooltipTrigger>
          <TooltipContent>Requires a LlamaRun Pro plan</TooltipContent>
        </Tooltip>
      )}
      {preview && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(chip, 'bg-amber-500/12 text-amber-600 dark:text-amber-400')}>Preview</span>
          </TooltipTrigger>
          <TooltipContent>Early access: behaviour and availability may change</TooltipContent>
        </Tooltip>
      )}
      {dev && <span className={cn(chip, 'bg-muted text-muted-foreground')}>Dev</span>}
    </span>
  )
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

/** "8B · Q4_K_M · 4.9 GB" for local models, the description for cloud ones. */
export function modelSummary(model: ModelInfo): string {
  if (model.cloud) return model.description ?? ''
  return [model.parameters, model.quantization, model.size ? formatBytes(model.size) : null].filter(Boolean).join(' · ')
}

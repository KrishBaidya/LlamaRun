import type { ComponentType } from 'react'
import { Brain, Cpu, Eye, Sparkles, Wrench, Zap, Bot } from 'lucide-react'
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
  const Icon = PROVIDER_ICONS[provider]
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
  fast: { label: 'Fast', hint: 'Low latency', icon: Zap }
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

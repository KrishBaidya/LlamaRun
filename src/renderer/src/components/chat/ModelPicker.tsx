import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, Download, Search, Settings2 } from 'lucide-react'
import type { ModelCatalog, ModelInfo } from '@shared/types'
import { CapabilityIcons, ModelBadges, ProviderIcon, formatContextWindow, modelSummary } from '@/components/models/model-meta'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from '@/hooks/use-llamarun'
import { cn } from '@/lib/utils'

let cache: ModelCatalog | null = null
const listeners = new Set<(c: ModelCatalog) => void>()

/** Reloads the catalog and updates every mounted picker. */
export async function refreshModelCatalog(): Promise<ModelCatalog> {
  const catalog = await api.models.list()
  cache = catalog
  for (const listener of listeners) listener(catalog)
  return catalog
}

/** Shared model catalog: served from memory immediately, refreshed on mount. */
export function useModelCatalog(): ModelCatalog | null {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(cache)
  useEffect(() => {
    listeners.add(setCatalog)
    void refreshModelCatalog().catch(() => {})
    return () => void listeners.delete(setCatalog)
  }, [])
  return catalog
}

export function findModel(catalog: ModelCatalog | null, id: string): ModelInfo | undefined {
  return catalog?.groups.flatMap((g) => g.models).find((m) => m.id === id)
}

export function modelName(catalog: ModelCatalog | null, id: string): string {
  return findModel(catalog, id)?.name ?? id
}

function matches(model: ModelInfo, query: string): boolean {
  const q = query.trim().toLowerCase()
  return !q || [model.name, model.id, model.description, model.family].some((f) => f?.toLowerCase().includes(q))
}

/** Compact model switcher used inside the composer: searchable, keyboard-driven. */
export function ModelPicker({
  value,
  onChange,
  disabled,
  className
}: {
  value: string
  onChange: (model: string) => void
  disabled?: boolean
  className?: string
}) {
  const catalog = useModelCatalog()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const groups = useMemo(
    () => catalog?.groups.map((g) => ({ ...g, models: g.models.filter((m) => matches(m, query)) })) ?? [],
    [catalog, query]
  )
  const flat = useMemo(() => groups.flatMap((g) => g.models), [groups])
  const current = findModel(catalog, value)

  useEffect(() => {
    if (!open) return
    setQuery('')
    const index = flat.findIndex((m) => m.id === value)
    setActive(Math.max(0, index))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (id: string): void => {
    onChange(id)
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(flat.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault()
      choose(flat[active].id)
    }
  }

  let index = -1
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          variant="ghost"
          size="sm"
          className={cn('max-w-56 gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground', className)}
        >
          {current && <ProviderIcon provider={current.provider} className="size-4 rounded-sm bg-transparent [&>svg]:size-3.5" />}
          <span className="truncate">{value ? (current?.name ?? value) : 'Choose model'}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-0" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models"
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {groups.map((group) =>
            group.models.length === 0 && (query || group.provider !== 'ollama') ? null : (
              <div key={group.provider} className="pb-1">
                <div className="px-2 pt-1.5 pb-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </div>
                {group.models.map((m) => {
                  index += 1
                  const i = index
                  return (
                    <button
                      key={m.id}
                      data-index={i}
                      onMouseMove={() => setActive(i)}
                      onClick={() => choose(m.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
                        i === active && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <ProviderIcon provider={m.provider} className="size-7" />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm">{m.name}</span>
                          <ModelBadges model={m} />
                        </span>
                        <span className="block truncate text-2xs text-muted-foreground">
                          {[modelSummary(m) || m.id, m.contextWindow ? `${formatContextWindow(m.contextWindow)} ctx` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <CapabilityIcons capabilities={m.capabilities} />
                      <Check className={cn('size-3.5 shrink-0', m.id === value ? 'opacity-100' : 'opacity-0')} />
                    </button>
                  )
                })}
                {group.provider === 'ollama' && group.models.length === 0 && !query && (
                  <button
                    onClick={() => void api.app.openExternal(catalog?.ollamaRunning ? 'https://ollama.com/library' : 'https://ollama.com/download')}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
                  >
                    <Download className="size-3.5" />
                    {catalog?.ollamaRunning ? 'No local models yet. Browse the Ollama library' : 'Ollama isn’t running. Get Ollama'}
                  </button>
                )}
              </div>
            )
          )}
          {flat.length === 0 && query && <div className="px-2 py-6 text-center text-xs text-muted-foreground">No models match “{query}”</div>}
        </div>
        <div className="border-t p-1">
          <button
            onClick={() => {
              setOpen(false)
              void api.app.openSettings('/models')
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Settings2 className="size-3.5" /> Browse all models…
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

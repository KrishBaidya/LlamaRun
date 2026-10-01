import { useMemo, useState } from 'react'
import { Check, Cloud, Download, HardDrive, LayoutGrid, List, LogIn, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { ModelCapability, ModelInfo } from '@shared/types'
import { refreshModelCatalog, useModelCatalog } from '@/components/chat/ModelPicker'
import { CAPABILITIES, CapabilityIcons, ProviderIcon, formatBytes, modelSummary } from '@/components/models/model-meta'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, useProfile, useSettings } from '@/hooks/use-llamarun'
import { cn, errorMessage } from '@/lib/utils'
import { EmptyState, Page, PageHeader } from '../components'

type Source = 'all' | 'cloud' | 'local'
type Layout = 'grid' | 'list'

const LAYOUT_KEY = 'llamarun.models.layout'

function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

/** Responsive card grid: 1 → 4 columns as the page gets wider. */
export const CARD_GRID = 'grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4'

function ModelCard({
  model,
  selected,
  layout,
  onSelect
}: {
  model: ModelInfo
  selected: boolean
  layout: Layout
  onSelect: () => void
}) {
  const details = model.cloud
    ? [model.provider === 'gemini' ? 'Google' : 'OpenAI', 'Cloud']
    : [model.parameters, model.quantization, model.size ? formatBytes(model.size) : null].filter(Boolean)
  return (
    <Card
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}
      className={cn(
        'relative cursor-pointer gap-3 px-4 py-4 transition-[background-color,box-shadow] outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50',
        selected && 'ring-2 ring-primary hover:bg-card',
        layout === 'list' && 'flex-row items-center gap-3 py-3'
      )}
    >
      <div className={cn('flex items-start gap-3', layout === 'list' && 'min-w-0 flex-1 items-center')}>
        <ProviderIcon provider={model.provider} className={layout === 'grid' ? 'size-9' : undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{model.name}</span>
          </div>
          <div className="truncate font-mono text-2xs text-muted-foreground" data-selectable>
            {model.id}
          </div>
        </div>
        {layout === 'grid' && (
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
              selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
            )}
          >
            {selected && <Check className="size-3" />}
          </span>
        )}
      </div>
      {layout === 'grid' ? (
        <>
          <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
            {model.description ?? (model.family ? `${model.family} family, runs on this computer` : 'Runs on this computer')}
          </p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
            <CapabilityIcons capabilities={model.capabilities} labels />
            <span className="text-2xs text-muted-foreground">{details.join(' · ')}</span>
          </div>
        </>
      ) : (
        <>
          <span className="hidden w-56 truncate text-xs text-muted-foreground @3xl:block">{modelSummary(model)}</span>
          <CapabilityIcons capabilities={model.capabilities} />
          <span className={cn('flex size-5 shrink-0 items-center justify-center', !selected && 'invisible')}>
            <Check className="size-4 text-primary" />
          </span>
        </>
      )}
    </Card>
  )
}

function OllamaEmpty({ running }: { running: boolean }) {
  return (
    <Card className="flex-row items-center gap-4 border-dashed px-5 py-4">
      <ProviderIcon provider="ollama" className="size-10" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium">{running ? 'No local models yet' : 'Ollama isn’t running'}</div>
        <div className="text-xs text-muted-foreground">
          {running ? (
            <>
              Download one in a terminal, e.g. <code className="rounded bg-muted px-1 font-mono">ollama pull llama3.2</code>, then refresh.
            </>
          ) : (
            'Install and start Ollama to run models privately on this computer.'
          )}
        </div>
      </div>
      <Button
        variant="outline"
        onClick={() => void api.app.openExternal(running ? 'https://ollama.com/library' : 'https://ollama.com/download')}
      >
        <Download /> {running ? 'Browse library' : 'Get Ollama'}
      </Button>
    </Card>
  )
}

export function ModelsPage() {
  const catalog = useModelCatalog()
  const profile = useProfile()
  const [settings, update] = useSettings()
  const [source, setSource] = useState<Source>('all')
  const [query, setQuery] = useState('')
  const [capability, setCapability] = useState<ModelCapability | null>(null)
  const [layout, setLayoutState] = useState<Layout>(readLayout)
  const [refreshing, setRefreshing] = useState(false)

  const setLayout = (next: Layout): void => {
    setLayoutState(next)
    try {
      localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      // per-viewer convenience only
    }
  }

  const selected = settings?.selectedModel ?? ''
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (catalog?.groups ?? [])
      .filter((g) => source === 'all' || (source === 'cloud') === (g.provider !== 'ollama'))
      .map((g) => ({
        ...g,
        models: g.models.filter(
          (m) =>
            (!q || [m.name, m.id, m.description, m.family].some((f) => f?.toLowerCase().includes(q))) &&
            (!capability || m.capabilities?.includes(capability))
        )
      }))
  }, [catalog, source, query, capability])
  const total = groups.reduce((n, g) => n + g.models.length, 0)
  const known = catalog?.groups.some((g) => g.models.some((m) => m.id === selected))

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await refreshModelCatalog()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRefreshing(false)
    }
  }

  const select = async (model: ModelInfo): Promise<void> => {
    if (model.id === selected) return
    await update({ selectedModel: model.id })
    toast.success(`${model.name} is now the default model`)
  }


  return (
    <Page wide>
      <PageHeader
        title="Models"
        description="Pick the default model for new chats. You can still switch models per chat from the composer."
        actions={
          <Button variant="outline" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} /> Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={source} onValueChange={(v) => setSource(v as Source)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="cloud">
              <Cloud /> Cloud
            </TabsTrigger>
            <TabsTrigger value="local">
              <HardDrive /> Local
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search models" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex items-center rounded-control border bg-card p-0.5">
          <Button size="icon-sm" variant={layout === 'grid' ? 'secondary' : 'ghost'} title="Card view" onClick={() => setLayout('grid')}>
            <LayoutGrid />
          </Button>
          <Button size="icon-sm" variant={layout === 'list' ? 'secondary' : 'ghost'} title="List view" onClick={() => setLayout('list')}>
            <List />
          </Button>
        </div>
      </div>
      <div className="-mt-2 flex flex-wrap items-center gap-1">
        <span className="me-1 text-xs text-muted-foreground">Show only</span>
        {(Object.keys(CAPABILITIES) as ModelCapability[]).map((cap) => {
          const { label, icon: Icon } = CAPABILITIES[cap]
          return (
            <Button
              key={cap}
              size="sm"
              variant={capability === cap ? 'secondary' : 'ghost'}
              className={cn('text-xs', capability === cap && 'ring-1 ring-border')}
              onClick={() => setCapability(capability === cap ? null : cap)}
            >
              <Icon /> {label}
            </Button>
          )
        })}
      </div>

      {profile && !profile.signedIn && source !== 'local' && (
        <Card className="flex-row items-center gap-3 px-4 py-3 text-sm">
          <LogIn className="size-4 text-muted-foreground" />
          <span className="flex-1 text-muted-foreground">Sign in to your LlamaRun account to use cloud models.</span>
          <Button size="sm" onClick={() => void api.auth.signIn()}>
            Sign in
          </Button>
        </Card>
      )}

      {selected && catalog && !known && (
        <Card className="flex-row items-center gap-3 border-amber-500/40 px-4 py-3 text-sm">
          <span className="flex-1">
            Your default model <code className="font-mono text-xs">{selected}</code> isn’t available right now. Choose another one below.
          </span>
        </Card>
      )}

      {!catalog ? (
        <div className="@container">
          <div className={CARD_GRID}>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        </div>
      ) : total === 0 && (query || capability) ? (
        <EmptyState icon={<Search />} title="No models match your filters" />
      ) : (
        <div className="@container flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.provider} className="flex flex-col gap-2.5">
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-semibold">{group.label}</h2>
                <span className="text-xs text-muted-foreground">
                  {group.provider === 'ollama'
                    ? `${group.models.length} on this computer`
                    : `${group.models.length} models`}
                </span>
              </div>
              {group.provider === 'ollama' && group.models.length === 0 && !query && !capability ? (
                <OllamaEmpty running={catalog.ollamaRunning} />
              ) : (
                <div className={layout === 'grid' ? CARD_GRID : 'flex flex-col gap-2'}>
                  {group.models.map((m) => (
                    <ModelCard
                      key={m.id}
                      model={m}
                      layout={layout}
                      selected={m.id === selected}
                      onSelect={() => void select(m)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </Page>
  )
}

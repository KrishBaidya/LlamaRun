import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { BadgeCheck, Globe, KeyRound, LoaderCircle, Plug, Plus, RefreshCw, Search, Terminal, Trash2, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import type { McpDirectoryServer, McpServerConfig, McpServerStatus } from '@shared/types'
import { SEARCH_DEBOUNCE_MS } from '@shared/constants'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, useDebounced, useIpcEvent } from '@/hooks/use-llamarun'
import { errorMessage, relativeTime } from '@/lib/utils'
import { EmptyState, Page, PageHeader } from '../components'
import { EMPTY_SERVER, McpConfigDialog } from '../McpConfigDialog'

function StatusBadge({ status }: { status?: McpServerStatus }) {
  if (!status) return null
  switch (status.state) {
    case 'connected':
      return (
        <Badge variant="success">
          <Wrench /> {status.toolCount} tools
        </Badge>
      )
    case 'connecting':
      return (
        <Badge variant="secondary">
          <LoaderCircle className="animate-spin" /> Connecting
        </Badge>
      )
    case 'error':
      return (
        <Badge variant="destructive" title={status.error}>
          Failed
        </Badge>
      )
    default:
      return <Badge variant="outline">Disconnected</Badge>
  }
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-52 flex-1">
      <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="pl-9" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function InstalledServers({ onAdd }: { onAdd: () => void }) {
  const [servers, setServers] = useState<McpServerConfig[] | null>(null)
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [query, setQuery] = useState('')
  const [toRemove, setToRemove] = useState<string | null>(null)

  const load = useCallback(() => {
    void api.mcp.list().then(setServers)
    void api.mcp.status().then(setStatuses)
  }, [])
  useEffect(load, [load])
  useIpcEvent(
    'mcp:changed',
    useCallback(
      (s: McpServerStatus[]) => {
        setStatuses(s)
        void api.mcp.list().then(setServers)
      },
      []
    )
  )

  const filtered = useMemo(
    () => servers?.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())),
    [servers, query]
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="Search installed servers" />
        <Button onClick={onAdd}>
          <Plus /> Add Server
        </Button>
      </div>
      {!filtered ? (
        <Skeleton className="h-20 w-full rounded-xl" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Plug />} title={query ? 'No matching servers' : 'No MCP servers installed'}>
          {!query && 'Browse "Available MCP Servers" or add one manually. Their tools become available to models and plugins.'}
        </EmptyState>
      ) : (
        <div className="@container">
          <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
        {filtered.map((s) => {
          const status = statuses.find((st) => st.name === s.name)
          const detail = s.mcpType === 'STDIO' ? [s.data.Command, ...(s.data.Arguments ?? [])].join(' ') : s.data.URL
          return (
            <Card key={s.name} className="flex-row items-center gap-4 px-5 py-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent">
                {s.mcpType === 'STDIO' ? <Terminal className="size-5" /> : <Globe className="size-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.name}</span>
                  <StatusBadge status={status} />
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground" data-selectable title={detail ?? ''}>
                  {detail}
                </div>
                {status?.state === 'error' && (
                  <div className="mt-1 line-clamp-4 text-xs whitespace-pre-wrap text-destructive" data-selectable title={status.error}>
                    {status.error}
                  </div>
                )}
              </div>
              <Button variant="ghost" size="icon" title="Remove" onClick={() => setToRemove(s.name)}>
                <Trash2 />
              </Button>
            </Card>
          )
        })}
          </div>
        </div>
      )}

      <AlertDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove MCP server?</AlertDialogTitle>
            <AlertDialogDescription>{toRemove} will be disconnected and removed from mcp.json.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const name = toRemove!
                setToRemove(null)
                void api.mcp
                  .remove(name)
                  .then(() => toast.success(`${name} removed`))
                  .catch((err) => toast.error(errorMessage(err)))
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DirectoryCard({ server, installed, onOpen }: { server: McpDirectoryServer; installed: boolean; onOpen: () => void }) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="cursor-pointer gap-2 px-4 py-4 transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold uppercase">
          {server.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{server.name}</span>
        {server.verified && <BadgeCheck className="size-4 shrink-0 text-primary" aria-label="Verified" />}
      </div>
      <p className="line-clamp-3 min-h-12 text-xs text-muted-foreground">{server.description}</p>
      <div className="mt-auto flex items-center gap-1.5 text-2xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{server.author || server.submittedBy}</span>
        {server.requiresAuth && <KeyRound className="size-3 shrink-0" aria-label="Requires an API key" />}
        {installed ? (
          <Badge variant="success">Installed</Badge>
        ) : (
          server.category && (
            <Badge variant="outline" className="max-w-28 truncate">
              {server.category}
            </Badge>
          )
        )}
      </div>
    </Card>
  )
}

/** Responsive card grid: 1 to 4 columns as the page gets wider. */
const CARD_GRID = 'grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4'

interface DirectoryState {
  servers: McpDirectoryServer[]
  cursor: string | null
  done: boolean
  fetchedAt: number
}

/**
 * Survives navigation within the Settings window, so opening a server's
 * details and going back restores the list, search and scroll position
 * instantly. The main process also caches pages on disk across restarts.
 */
const directory = {
  results: new Map<string, DirectoryState>(),
  query: '',
  scrollTop: 0
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  return el?.closest<HTMLElement>('.overflow-y-auto') ?? null
}

function updatedLabel(ts: number): string {
  const rel = relativeTime(ts)
  if (rel === 'now') return 'Updated just now'
  return /\d[mhd]$/.test(rel) ? `Updated ${rel} ago` : `Updated ${rel}`
}

function AvailableServers() {
  const navigate = useNavigate()
  const [query, setQuery] = useState(directory.query)
  const search = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS)
  const [state, setState] = useState<DirectoryState | null>(() => directory.results.get(directory.query.trim()) ?? null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const requestId = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.mcp.list().then((list) => setInstalled(new Set(list.map((s) => s.name.toLowerCase()))))
  }, [])

  const commit = useCallback((key: string, next: DirectoryState) => {
    directory.results.set(key, next)
    setState(next)
  }, [])

  const load = useCallback(
    async (mode: 'reset' | 'more' | 'refresh'): Promise<void> => {
      const key = search
      const id = ++requestId.current
      const current = directory.results.get(key)
      if (mode === 'refresh') setRefreshing(true)
      else setLoading(true)
      setError(null)
      let revalidate = false
      try {
        const page = await api.mcp.directory({
          search: key || undefined,
          cursor: mode === 'more' ? current?.cursor : null,
          fresh: mode === 'refresh'
        })
        if (id !== requestId.current) return
        if (mode === 'more' && current) {
          const seen = new Set(current.servers.map((s) => s.id))
          commit(key, {
            servers: [...current.servers, ...page.servers.filter((s) => !seen.has(s.id))],
            cursor: page.nextCursor,
            done: !page.nextCursor,
            fetchedAt: current.fetchedAt
          })
        } else {
          const fetchedAt = page.cachedAt ?? Date.now()
          commit(key, { servers: page.servers, cursor: page.nextCursor, done: !page.nextCursor, fetchedAt })
        }
        // A stale copy from the disk cache is shown right away, then refreshed quietly.
        revalidate = mode === 'reset' && !!page.stale
      } catch (err) {
        if (id === requestId.current) {console.error(err); setError(errorMessage(err))}
      } finally {
        if (id === requestId.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
      if (revalidate) void load('refresh')
    },
    [search, commit]
  )

  // New search: show what is already cached for it, fetch otherwise.
  useEffect(() => {
    directory.query = search
    const cached = directory.results.get(search)
    setState(cached ?? null)
    setError(null)
    if (!cached) void load('reset')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Restore the scroll position after coming back from a details page.
  useLayoutEffect(() => {
    const scroller = scrollParent(root.current)
    if (scroller && state) scroller.scrollTop = directory.scrollTop
    return () => {
      if (scroller) directory.scrollTop = scroller.scrollTop
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Infinite scroll: load the next page before the sentinel comes into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && state && !state.done && !error) void load('more')
      },
      { rootMargin: '400px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [load, loading, state, error])

  const servers = state?.servers ?? []
  return (
    <div ref={root} className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="Search the MCP directory" />
        {state && <span className="hidden text-xs whitespace-nowrap text-muted-foreground sm:block">{updatedLabel(state.fetchedAt)}</span>}
        <Button
          variant="outline"
          size="icon"
          title="Refresh the directory"
          disabled={loading || refreshing}
          onClick={() => {
            // A manual refresh also drops cached pages for other searches.
            directory.results.clear()
            void api.mcp.clearDirectoryCache().then(() => load('refresh'))
          }}
        >
          <RefreshCw className={refreshing ? 'animate-spin' : ''} />
        </Button>
      </div>
      {error && (
        <Card className="flex-row items-center justify-between px-5 py-4 text-sm">
          <span className="text-destructive">{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load(servers.length ? 'more' : 'reset')}>
            Retry
          </Button>
        </Card>
      )}
      {!error && !loading && state && servers.length === 0 && <EmptyState icon={<Search />} title="No servers found" />}
      <div className="@container">
        <div className={CARD_GRID}>
          {servers.map((s) => (
            <DirectoryCard
              key={s.id}
              server={s}
              installed={installed.has(s.name.toLowerCase())}
              onOpen={() => void navigate(`/mcp/server/${encodeURIComponent(s.id)}`, { state: s })}
            />
          ))}
          {loading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      </div>
      <div ref={sentinel} className="h-4" />
    </div>
  )
}

export function McpPage() {
  const [adding, setAdding] = useState(false)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'available' ? 'available' : 'installed'
  return (
    <Page wide>
      <PageHeader title="MCP Servers" description="Connect Model Context Protocol servers to give models and plugins new tools." />
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'available' ? { tab: v } : {}, { replace: true })}>
        <TabsList>
          <TabsTrigger value="installed">Installed MCP Servers</TabsTrigger>
          <TabsTrigger value="available">Available MCP Servers</TabsTrigger>
        </TabsList>
        <TabsContent value="installed" className="pt-2">
          <InstalledServers onAdd={() => setAdding(true)} />
        </TabsContent>
        <TabsContent value="available" className="pt-2">
          <AvailableServers />
        </TabsContent>
      </Tabs>
      <McpConfigDialog config={EMPTY_SERVER} open={adding} onOpenChange={setAdding} />
    </Page>
  )
}

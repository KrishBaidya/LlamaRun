import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertTriangle,
  Blocks,
  ChevronRight,
  Code2,
  FileArchive,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldAlert
} from 'lucide-react'
import { toast } from 'sonner'
import type { PluginInfo, PluginInspection, PluginRuntimeStatus } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, useIpcEvent } from '@/hooks/use-llamarun'
import { errorMessage } from '@/lib/utils'
import { EmptyState, Page, PageHeader } from '../components'
import { PermissionConsentDialog, type ConsentRequest } from '../PermissionConsentDialog'

export function RuntimeBadge({ status }: { status: PluginRuntimeStatus | null }) {
  if (!status) return null
  if (status.state === 'running') {
    return <Badge variant="success">Python {status.pythonVersion ?? ''}</Badge>
  }
  if (status.state === 'starting') {
    return (
      <Badge variant="secondary">
        <LoaderCircle className="animate-spin" /> Starting Python…
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" title={status.error}>
      Python {status.state}
    </Badge>
  )
}

export function StateBadge({ plugin }: { plugin: PluginInfo }) {
  switch (plugin.state) {
    case 'running':
      return null
    case 'starting':
      return (
        <Badge variant="secondary">
          <LoaderCircle className="animate-spin" /> Starting
        </Badge>
      )
    case 'crashed':
      return <Badge variant="destructive">Crashed</Badge>
    case 'error':
      return (
        <Badge variant="destructive" title={plugin.error}>
          <AlertTriangle /> Error
        </Badge>
      )
    case 'needs-consent':
      return (
        <Badge variant="outline">
          <ShieldAlert /> Needs approval
        </Badge>
      )
    default:
      return null
  }
}

/** Install flow: pick → review permissions → install. Shared with the details page. */
export function useInstaller(onInstalled?: (list: PluginInfo[]) => void) {
  const [inspection, setInspection] = useState<PluginInspection | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (kind: PluginInspection['kind']): Promise<void> => {
    try {
      const result = await api.plugins.inspect(kind)
      if (result) setInspection(result)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const request: ConsentRequest | null = inspection && {
    title: inspection.existing ? `Update ${inspection.name}?` : inspection.kind === 'link' ? `Link ${inspection.name}?` : `Install ${inspection.name}?`,
    name: inspection.name,
    author: inspection.author,
    version: inspection.version,
    permissions: inspection.permissions,
    previouslyGranted: inspection.existing?.granted,
    note: [
      inspection.kind === 'link' ? 'Linked plugins run from their folder and restart when you save a file.' : '',
      inspection.hasRequirements ? 'Its Python packages (requirements.txt) will be downloaded now.' : ''
    ]
      .filter(Boolean)
      .join(' '),
    confirmLabel: inspection.existing ? 'Update' : inspection.kind === 'link' ? 'Link' : 'Install'
  }

  const confirm = async (grants: PluginInspection['permissions'][number]['id'][]): Promise<void> => {
    if (!inspection) return
    setBusy(true)
    try {
      const list = await api.plugins.install(inspection.source, inspection.kind, grants)
      toast.success(`${inspection.name} ${inspection.existing ? 'updated' : 'installed'}`)
      onInstalled?.(list)
      setInspection(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const dialog = (
    <PermissionConsentDialog request={request} busy={busy} onCancel={() => setInspection(null)} onConfirm={(g) => void confirm(g)} />
  )
  return { pick, dialog, busy }
}

function PluginRow({ plugin, onToggle, onOpen }: { plugin: PluginInfo; onToggle: (enabled: boolean) => void; onOpen: () => void }) {
  const problem = plugin.state === 'error' || plugin.state === 'crashed'
  return (
    <Card className="flex-row items-center gap-4 px-4 py-3 transition-colors hover:bg-accent/40" onClick={onOpen} role="button">
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-accent">
        {plugin.icon ? <img src={plugin.icon} alt="" className="size-full object-cover" /> : <Blocks className="size-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{plugin.name}</span>
          {plugin.linked && (
            <Badge variant="outline" title={plugin.folder}>
              <Code2 /> Dev
            </Badge>
          )}
          {plugin.legacy && <Badge variant="outline">Full access</Badge>}
          <StateBadge plugin={plugin} />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {plugin.author || 'Unknown author'} · {plugin.version || '—'}
        </div>
        {problem && plugin.error ? (
          <div className="mt-1 line-clamp-2 text-xs text-destructive" data-selectable>
            {plugin.error}
          </div>
        ) : (
          plugin.description && <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{plugin.description}</div>
        )}
      </div>
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {plugin.state === 'needs-consent' ? (
          <Button size="sm" variant="outline" onClick={onOpen}>
            Review
          </Button>
        ) : (
          <Switch checked={plugin.enabled} onCheckedChange={onToggle} disabled={!plugin.module} aria-label="Enabled" />
        )}
      </div>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Card>
  )
}

function InstalledPlugins() {
  const navigate = useNavigate()
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [status, setStatus] = useState<PluginRuntimeStatus | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const installer = useInstaller(setPlugins)

  const refreshStatus = useCallback(() => void api.plugins.runtime().then(setStatus), [])
  useEffect(() => {
    void api.plugins
      .list()
      .then(setPlugins)
      .catch((err) => {
        setPlugins([])
        toast.error(errorMessage(err))
      })
      .finally(refreshStatus)
  }, [refreshStatus])
  useIpcEvent(
    'plugins:changed',
    useCallback(
      (list: PluginInfo[]) => {
        setPlugins(list)
        refreshStatus()
      },
      [refreshStatus]
    )
  )

  const run = async (fn: () => Promise<PluginInfo[]>, success?: string): Promise<void> => {
    setBusy(true)
    try {
      setPlugins(await fn())
      if (success) toast.success(success)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
      refreshStatus()
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!plugins || !q) return plugins
    return plugins.filter((p) => [p.name, p.author, p.description].some((f) => f?.toLowerCase().includes(q)))
  }, [plugins, query])

  const working = busy || installer.busy
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search plugins" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <RuntimeBadge status={status} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={working}>
              {working ? <LoaderCircle className="animate-spin" /> : <FolderPlus />} Install from Disk
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void installer.pick('folder')}>
              <FolderPlus /> Plugin folder…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void installer.pick('zip')}>
              <FileArchive /> Plugin .zip…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void installer.pick('link')}>
              <Code2 /> Link folder for development…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="icon" title="Reload all plugins" disabled={working} onClick={() => void run(() => api.plugins.reload(), 'Plugins reloaded')}>
          <RefreshCw />
        </Button>
        <Button variant="outline" size="icon" title="Open plugins folder" onClick={() => void api.plugins.openFolder()}>
          <FolderOpen />
        </Button>
      </div>

      {status?.state === 'unavailable' && (
        <Card className="border-destructive/40 px-5 py-4 text-sm">
          <div className="font-medium text-destructive">Python runtime unavailable</div>
          <div className="text-muted-foreground" data-selectable>
            {status.error}
          </div>
        </Card>
      )}

      {!filtered ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Blocks />} title={query ? 'No matching plugins' : 'No plugins installed'}>
          {!query && 'Plugins are Python packages built with the llamarun SDK. Use "Install from Disk" to add one.'}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((p) => (
            <PluginRow
              key={p.id}
              plugin={p}
              onOpen={() => navigate(`/plugins/${encodeURIComponent(p.id)}`)}
              onToggle={(enabled) => void run(() => api.plugins.setEnabled(p.id, enabled))}
            />
          ))}
        </div>
      )}
      {installer.dialog}
    </div>
  )
}

export function PluginsPage() {
  return (
    <Page>
      <PageHeader
        title="Plugins"
        description="Extend Llama Run with Python plugins. Each one runs on the bundled Python in its own sandbox, with only the permissions you allow."
      />
      <Tabs defaultValue="installed">
        <TabsList>
          <TabsTrigger value="installed">Installed Plugins</TabsTrigger>
          <TabsTrigger value="available">Available Plugins</TabsTrigger>
        </TabsList>
        <TabsContent value="installed" className="pt-2">
          <InstalledPlugins />
        </TabsContent>
        <TabsContent value="available" className="pt-2">
          <EmptyState icon={<Blocks />} title="Plugin marketplace coming soon">
            In the meantime, build your own with the llamarun SDK. See docs/plugin-sdk.md in the repository.
          </EmptyState>
        </TabsContent>
      </Tabs>
    </Page>
  )
}

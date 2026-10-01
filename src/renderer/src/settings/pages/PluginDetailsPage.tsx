import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft, Blocks, FolderOpen, LoaderCircle, MoreHorizontal, Play, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { PermissionInfo, PluginInfo, PluginPermission, PluginSettingsView } from '@shared/types'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { api, useIpcEvent } from '@/hooks/use-llamarun'
import { errorMessage } from '@/lib/utils'
import { TreeRenderer, type Values } from '@/plugin-kit/TreeRenderer'
import { Page } from '../components'
import { PermissionConsentDialog, type ConsentRequest } from '../PermissionConsentDialog'
import { StateBadge } from './PluginsPage'

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function SettingsForm({ plugin }: { plugin: PluginInfo }) {
  const [view, setView] = useState<PluginSettingsView | null>(null)
  const [values, setValues] = useState<Values>({})
  const [saving, setSaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Values>({})

  const load = useCallback(() => {
    void api.plugins.settings(plugin.id).then((v) => {
      setView(v)
      setValues((current) => ({ ...v.values, ...pending.current, ...(Object.keys(pending.current).length ? current : {}) }))
    })
  }, [plugin.id])
  useEffect(load, [load])
  useIpcEvent(
    'plugins:settingsChanged',
    useCallback((id: string) => id === plugin.id && load(), [plugin.id, load])
  )

  const onChange = (name: string, value: unknown): void => {
    setValues((v) => ({ ...v, [name]: value }))
    pending.current = { ...pending.current, [name]: value }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const patch = pending.current
      pending.current = {}
      setSaving(true)
      api.plugins
        .saveSettings(plugin.id, patch)
        .catch((err) => toast.error(errorMessage(err)))
        .finally(() => setSaving(false))
    }, 400)
  }

  if (!view?.schema) {
    return (
      <Card className="px-5 py-4 text-sm text-muted-foreground">
        {plugin.loaded
          ? 'This plugin has no settings.'
          : 'Settings appear here while the plugin is running.'}
      </Card>
    )
  }
  return (
    <Card className="relative px-5 py-5">
      {saving && <LoaderCircle className="absolute top-4 right-4 size-4 animate-spin text-muted-foreground" />}
      <TreeRenderer tree={view.schema} values={values} onChange={onChange} />
    </Card>
  )
}

function Permissions({
  plugin,
  catalog,
  onChange
}: {
  plugin: PluginInfo
  catalog: PermissionInfo[]
  onChange: (grants: PluginPermission[]) => void
}) {
  const info = (id: PluginPermission): PermissionInfo | undefined => catalog.find((p) => p.id === id)
  const granted = new Set(plugin.granted)
  if (plugin.permissions.length === 0) {
    return <Card className="px-5 py-4 text-sm text-muted-foreground">This plugin needs no permissions. It can only use its own data folder.</Card>
  }
  return (
    <Card className="gap-0 divide-y py-0">
      {plugin.permissions.map((id) => {
        const p = info(id)
        const blocked = plugin.blocked.includes(id)
        return (
          <div key={id} className="flex items-start justify-between gap-4 px-5 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {p?.label ?? id}
                {p && p.risk === 'high' && <Badge variant="destructive">high risk</Badge>}
                {!p?.enforced && p && <Badge variant="outline">not enforced</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">{p?.description}</p>
              {blocked && !granted.has(id) && (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <ShieldAlert className="size-3.5" /> The plugin recently tried to use this and was blocked.
                </p>
              )}
            </div>
            {plugin.legacy ? (
              <Badge variant={granted.has(id) ? 'secondary' : 'outline'}>{granted.has(id) ? 'Allowed' : 'Not allowed'}</Badge>
            ) : (
              <Switch
                checked={granted.has(id)}
                disabled={plugin.state === 'needs-consent'}
                onCheckedChange={(on) => onChange(plugin.permissions.filter((x) => (x === id ? on : granted.has(x))))}
                aria-label={p?.label ?? id}
              />
            )}
          </div>
        )
      })}
      {/* Permissions the sandbox blocked that the plugin never asked for: a manifest bug worth surfacing. */}
      {plugin.blocked
        .filter((id) => !plugin.permissions.includes(id))
        .map((id) => (
          <div key={id} className="flex items-center gap-2 px-5 py-3 text-xs text-amber-600 dark:text-amber-400">
            <ShieldAlert className="size-3.5" /> Tried to use “{info(id)?.label ?? id}”, which it doesn't request in plugin.json.
          </div>
        ))}
    </Card>
  )
}

function Facts({ plugin }: { plugin: PluginInfo }) {
  const rows: [string, React.ReactNode][] = [
    ['Module', <code key="m">{plugin.module || '—'}</code>],
    ['SDK', plugin.sdkVersion || '—'],
    ['Folder', <span key="f" className="break-all">{plugin.folder}</span>]
  ]
  const deps = Object.entries(plugin.dependencies)
  if (deps.length) rows.push(['Depends on', deps.map(([m, v]) => `${m} ${v}`).join(', ')])
  if (plugin.services.length) rows.push(['Offers to other plugins', plugin.services.join(', ')])
  if (plugin.subscriptions.length) rows.push(['Listens to', plugin.subscriptions.join(', ')])
  if (plugin.hooks.length) rows.push(['Chat hooks', plugin.hooks.map((h) => h.replace(/_/g, ' ')).join(', ')])
  if (plugin.panels.length) rows.push(['Panels', plugin.panels.join(', ')])
  return (
    <Card className="gap-0 py-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-4 px-5 py-1.5 text-xs">
          <span className="w-44 shrink-0 text-muted-foreground">{k}</span>
          <span className="min-w-0" data-selectable>
            {v}
          </span>
        </div>
      ))}
    </Card>
  )
}

export function PluginDetailsPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [plugin, setPlugin] = useState<PluginInfo | null | undefined>(undefined)
  const [catalog, setCatalog] = useState<PermissionInfo[]>([])
  const [consent, setConsent] = useState<ConsentRequest | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, setBusy] = useState(false)

  const pick = useCallback((list: PluginInfo[]) => setPlugin(list.find((p) => p.id === id) ?? null), [id])
  useEffect(() => {
    void api.plugins.list().then(pick)
    void api.plugins.permissionCatalog().then(setCatalog)
  }, [pick])
  useIpcEvent('plugins:changed', pick)

  const run = async (fn: () => Promise<PluginInfo[] | void>, success?: string): Promise<void> => {
    setBusy(true)
    try {
      const list = await fn()
      if (list) pick(list)
      if (success) toast.success(success)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (plugin === undefined) return null
  if (plugin === null) {
    return (
      <Page>
        <Button variant="ghost" className="w-fit" onClick={() => navigate('/plugins')}>
          <ArrowLeft /> Plugins
        </Button>
        <p className="text-sm text-muted-foreground">This plugin isn't installed any more.</p>
      </Page>
    )
  }

  const review = (): void =>
    setConsent({
      title: `Allow ${plugin.name}?`,
      name: plugin.name,
      author: plugin.author,
      version: plugin.version,
      permissions: plugin.permissions.map((p) => catalog.find((c) => c.id === p)!).filter(Boolean),
      confirmLabel: 'Allow and start'
    })

  return (
    <Page>
      <Button variant="ghost" size="sm" className="-ms-2 w-fit text-muted-foreground" onClick={() => navigate('/plugins')}>
        <ArrowLeft /> Plugins
      </Button>

      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent">
          {plugin.icon ? <img src={plugin.icon} alt="" className="size-full object-cover" /> : <Blocks className="size-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{plugin.name}</h1>
            <StateBadge plugin={plugin} />
          </div>
          <div className="text-xs text-muted-foreground">
            {plugin.author || 'Unknown author'} · {plugin.version}
            {plugin.linked && ' · linked for development'}
          </div>
          {plugin.description && <p className="mt-1 text-sm text-muted-foreground">{plugin.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {plugin.state !== 'needs-consent' && (
            <Switch checked={plugin.enabled} disabled={busy || !plugin.module} onCheckedChange={(on) => void run(() => api.plugins.setEnabled(plugin.id, on))} aria-label="Enabled" />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {plugin.actions.length > 0 && <DropdownMenuLabel>Actions</DropdownMenuLabel>}
              {plugin.actions.map((action) => (
                <DropdownMenuItem key={action} disabled={!plugin.loaded} onSelect={() => void run(() => api.plugins.runAction(plugin.id, action))}>
                  <Play /> {action}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => void run(() => api.plugins.reload(plugin.id), `${plugin.name} reloaded`)}>
                <RefreshCw /> Reload Plugin
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void api.plugins.openDataFolder(plugin.id)}>
                <FolderOpen /> Open Data Folder
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmRemove(true)}>
                <Trash2 /> {plugin.linked ? 'Unlink Plugin' : 'Delete Plugin'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {plugin.state === 'needs-consent' && (
        <Card className="flex-row items-center gap-3 border-amber-500/40 px-5 py-4">
          <ShieldAlert className="size-5 shrink-0 text-amber-500" />
          <div className="flex-1 text-sm">
            <div className="font-medium">Waiting for your approval</div>
            <div className="text-xs text-muted-foreground">Review what this plugin can do before it starts.</div>
          </div>
          <Button onClick={review}>Review</Button>
        </Card>
      )}
      {(plugin.state === 'error' || plugin.state === 'crashed') && plugin.error && (
        <Card className="border-destructive/40 px-5 py-4">
          <div className="text-sm font-medium text-destructive">{plugin.state === 'crashed' ? 'Crashed' : 'Couldn’t start'}</div>
          <pre className="mt-1 max-h-48 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground" data-selectable>
            {plugin.error}
          </pre>
        </Card>
      )}

      {plugin.actions.length > 0 && plugin.loaded && (
        <div className="flex flex-wrap gap-2">
          {plugin.actions.map((action) => (
            <Button key={action} variant="outline" size="sm" onClick={() => void run(() => api.plugins.runAction(plugin.id, action))}>
              <Play /> {action}
            </Button>
          ))}
        </div>
      )}

      <Section title="Settings">
        <SettingsForm plugin={plugin} />
      </Section>

      <Section title="Permissions" description="Turning one off restarts the plugin.">
        <Permissions plugin={plugin} catalog={catalog} onChange={(grants) => void run(() => api.plugins.setGrants(plugin.id, grants))} />
      </Section>

      <Section title="Details">
        <Facts plugin={plugin} />
      </Section>

      <PermissionConsentDialog
        request={consent}
        busy={busy}
        onCancel={() => setConsent(null)}
        onConfirm={(grants) => {
          setConsent(null)
          void run(() => api.plugins.setGrants(plugin.id, grants), `${plugin.name} allowed`)
        }}
      />

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{plugin.linked ? 'Unlink plugin?' : 'Remove plugin?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {plugin.linked
                ? `${plugin.name} will stop and be removed from Llama Run. Its source folder is left alone.`
                : `${plugin.name} will be unloaded and its folder deleted. Its saved data and settings are kept, so reinstalling restores them.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                void run(async () => {
                  await api.plugins.remove(plugin.id)
                  navigate('/plugins')
                }, `${plugin.name} removed`)
              }
            >
              {plugin.linked ? 'Unlink' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  )
}

import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, BadgeCheck, BookOpen, Download, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react'
import type { McpDirectoryServer, McpServerConfig } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/hooks/use-llamarun'
import { errorMessage } from '@/lib/utils'
import { Page } from '../components'
import { McpConfigDialog } from '../McpConfigDialog'

function ReadmeViewer({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setState('loading')
    void api.mcp.readmeUrl(id).then((u) => setUrl(`${u}${u.includes('?') ? '&' : '?'}r=${attempt}`))
    // Frames don't report network errors, so treat a slow load as a failure.
    const timer = setTimeout(() => setState((s) => (s === 'loading' ? 'error' : s)), 15_000)
    return () => clearTimeout(timer)
  }, [id, attempt])

  return (
    <Card className="relative h-[520px] overflow-hidden p-0">
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Loading README…
        </div>
      )}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          Could not load the README.
          <Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)}>
            <RefreshCw /> Retry
          </Button>
        </div>
      )}
      {url && state !== 'error' && (
        <iframe
          key={url}
          src={url}
          title="README"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className="size-full border-0 bg-white"
          onLoad={() => setState('ready')}
        />
      )}
    </Card>
  )
}

export function McpServerDetailsPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [server, setServer] = useState<McpDirectoryServer | null>((location.state as McpDirectoryServer) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<McpServerConfig | null>(null)

  useEffect(() => {
    if (server) return
    api.mcp
      .directoryServer(id)
      .then(setServer)
      .catch((err) => setError(errorMessage(err)))
  }, [id, server])

  const install = async (): Promise<void> => {
    if (server) setConfig(await api.mcp.configFromDirectory(server))
  }

  return (
    <Page>
      <Button variant="ghost" className="w-fit" onClick={() => void (history.state?.idx > 0 ? navigate(-1) : navigate('/mcp?tab=available'))}>
        <ArrowLeft /> Back
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!server && !error ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (
        server && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <h1 className="flex items-center gap-2 text-2xl font-semibold">
                  {server.name} {server.verified && <BadgeCheck className="size-5 text-primary" />}
                </h1>
                <p className="text-muted-foreground" data-selectable>
                  {server.longDescription || server.description}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {(server.author || server.submittedBy) && <span>by {server.author || server.submittedBy}</span>}
                  {server.category && <Badge variant="outline">{server.category}</Badge>}
                  {server.requiresAuth && <Badge variant="secondary">Requires API key</Badge>}
                  {server.tags?.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button onClick={() => void install()}>
                  <Download /> Install
                </Button>
                {server.repositoryUrl && (
                  <Button variant="outline" onClick={() => void api.app.openExternal(server.repositoryUrl!)}>
                    <ExternalLink /> Repository
                  </Button>
                )}
                {server.documentationUrl && (
                  <Button variant="outline" onClick={() => void api.app.openExternal(server.documentationUrl!)}>
                    <BookOpen /> Docs
                  </Button>
                )}
              </div>
            </div>
            <ReadmeViewer id={server.id} />
          </>
        )
      )}
      <McpConfigDialog
        config={config}
        open={!!config}
        onOpenChange={(o) => !o && setConfig(null)}
        onSaved={() => void navigate('/mcp')}
      />
    </Page>
  )
}

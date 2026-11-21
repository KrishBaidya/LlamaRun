import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, AppWindow, Loader2, PanelRightOpen, X } from 'lucide-react'
import type { McpAppRef, McpAppResource } from '@shared/types'
import { appCsp } from '@shared/mcpApps'
import { Button } from '@/components/ui/button'
import { api } from '@/hooks/use-llamarun'
import { McpAppBridge, type DisplayMode, type HostContext } from '@shared/mcpAppBridge'
import { cn } from '@/lib/utils'

/**
 * MCP Apps: an MCP server's own interface for a tool (a dashboard, an editor,
 * a form), shown with the tool's result and talking to that server. Inline in
 * the reply, or in a panel beside the chat ("fullscreen" in the spec's terms).
 */

const INLINE_MAX_HEIGHT = 600
const INLINE_MIN_HEIGHT = 80

/** The chat's app panel: which app is open beside the chat. */
interface PanelState {
  chatId: string | null
  /** The open app and the tool call it came from. */
  open: { id: string; app: McpAppRef } | null
  show(open: { id: string; app: McpAppRef } | null): void
}
const PanelContext = createContext<PanelState>({ chatId: null, open: null, show: () => undefined })
export const useAppPanel = (): PanelState => useContext(PanelContext)

export function McpAppPanelProvider({ chatId, children }: { chatId: string | null; children: ReactNode }) {
  const [open, setOpen] = useState<PanelState['open']>(null)
  // A different chat closes the panel.
  useEffect(() => setOpen(null), [chatId])
  return <PanelContext.Provider value={{ chatId, open, show: setOpen }}>{children}</PanelContext.Provider>
}

const isDark = (): boolean => document.documentElement.classList.contains('dark')

/** Llama Run's colours and font under the spec's variable names, so apps can match the app. */
function themeVariables(): Record<string, string> {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string): string => css.getPropertyValue(name).trim()
  const pairs: [string, string][] = [
    ['--color-background-primary', v('--background')],
    ['--color-background-secondary', v('--card')],
    ['--color-background-tertiary', v('--muted')],
    ['--color-text-primary', v('--foreground')],
    ['--color-text-secondary', v('--muted-foreground')],
    ['--color-border-primary', v('--border')],
    ['--color-ring-primary', v('--ring')],
    ['--font-sans', getComputedStyle(document.body).fontFamily]
  ]
  return Object.fromEntries(pairs.filter(([, value]) => value))
}

/** One running view of an app. */
function AppFrame({ app: given, mode, onMode, className }: { app: McpAppRef; mode: DisplayMode; onMode: (m: DisplayMode) => void; className?: string }) {
  const { chatId } = useAppPanel()
  // The chat hands over a new object on every update; the view restarts only when the call itself differs.
  const key = JSON.stringify([given.server, given.uri, given.tool, given.args, given.result])
  const [app, setApp] = useState(given)
  useEffect(() => setApp(given), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const onModeRef = useRef(onMode)
  onModeRef.current = onMode
  const frame = useRef<HTMLIFrameElement>(null)
  const bridge = useRef<McpAppBridge | null>(null)
  const [resource, setResource] = useState<McpAppResource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState(INLINE_MIN_HEIGHT * 2)

  useEffect(() => {
    let live = true
    setResource(null)
    setError(null)
    api.mcpApps
      .resource(app.server, app.uri)
      .then((r) => live && setResource(r))
      .catch((err: Error) => live && setError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    return () => {
      live = false
    }
  }, [app.server, app.uri])

  useEffect(() => {
    if (!resource) return
    const post = (message: Record<string, unknown>): void => frame.current?.contentWindow?.postMessage(message, '*')
    const context: HostContext = {
      theme: isDark() ? 'dark' : 'light',
      displayMode: mode,
      containerDimensions: mode === 'inline' ? { maxHeight: INLINE_MAX_HEIGHT } : { height: frame.current?.clientHeight ?? 600, width: frame.current?.clientWidth ?? 600 },
      styles: { variables: themeVariables() },
      locale: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
    const b = new McpAppBridge(app, resource.csp, {
      post,
      callTool: (name, args) => api.mcpApps.callTool(app.server, name, args),
      readResource: (uri) => api.mcpApps.readResource(app.server, uri),
      openLink: (url) => void api.app.openExternal(url),
      message: (text) => chatId && void api.mcpApps.message(chatId, app.server, text),
      setContext: (text) => chatId && void api.mcpApps.setContext(chatId, app.server, text),
      requestMode: (m) => (onModeRef.current(m), m),
      resized: (_w, h) => h !== undefined && setHeight(Math.max(INLINE_MIN_HEIGHT, Math.min(INLINE_MAX_HEIGHT, Math.ceil(h)))),
      log: (level, data) => console.debug(`[${app.server} app] ${level}`, data)
    }, context)
    bridge.current = b
    const onMessage = (e: MessageEvent): void => {
      if (e.source !== frame.current?.contentWindow) return
      if ((e.data as { llamarunApp?: string })?.llamarunApp === 'ready') post({ llamarunApp: 'load', html: resource.html, csp: appCsp(resource.csp) })
      else void b.handle(e.data)
    }
    window.addEventListener('message', onMessage)
    // The page may already be loaded (and waiting) by the time the resource arrives.
    frame.current?.contentWindow?.location.replace(frame.current.src)
    // Light/dark follows the app.
    const watch = new MutationObserver(() => b.contextChanged({ theme: isDark() ? 'dark' : 'light', styles: { variables: themeVariables() } }))
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      b.teardown('closed')
      watch.disconnect()
      window.removeEventListener('message', onMessage)
      bridge.current = null
    }
    // A new mode remounts nothing: it's sent as a context change below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, app, chatId])

  useEffect(() => {
    const el = frame.current
    bridge.current?.contextChanged({
      displayMode: mode,
      containerDimensions: mode === 'inline' ? { maxHeight: INLINE_MAX_HEIGHT } : { height: el?.clientHeight ?? 600, width: el?.clientWidth ?? 600 }
    })
  }, [mode])

  if (error)
    return (
      <p className="flex items-start gap-1.5 px-2 py-2 text-2xs text-destructive">
        <AlertCircle className="mt-px size-3 shrink-0" /> Couldn't open the {app.server} app: {error}
      </p>
    )
  if (!resource)
    return (
      <p className="flex items-center gap-1.5 px-2 py-2 text-2xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Opening the {app.server} app…
      </p>
    )
  const allow = resource.permissions.map((p) => (p === 'clipboardWrite' ? 'clipboard-write' : p)).join('; ')
  return (
    <iframe
      ref={frame}
      title={`${app.server} app`}
      src="mcp-app.html"
      // Scripts and forms, never same-origin: the app can't reach Llama Run, only send it messages.
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
      allow={allow || undefined}
      className={cn('block w-full border-0', resource.prefersBorder !== false && 'bg-background', className)}
      style={mode === 'inline' ? { height } : undefined}
    />
  )
}

/** An app under its tool card in a reply; its button moves it to the panel beside the chat. */
export function McpAppInline({ id, app }: { id: string; app: McpAppRef }) {
  const panel = useAppPanel()
  const inPanel = panel.open?.id === id
  return (
    <div className="overflow-hidden rounded-lg border border-border/70">
      <div className="flex items-center gap-1.5 border-b border-border/70 bg-card px-2 py-1 text-2xs text-muted-foreground">
        <AppWindow className="size-3" />
        <span className="min-w-0 truncate">{app.server}</span>
        <Button variant="ghost" size="sm" className="ms-auto h-6 px-1.5 text-2xs" onClick={() => panel.show(inPanel ? null : { id, app })}>
          <PanelRightOpen className="size-3" /> {inPanel ? 'Close panel' : 'Open beside chat'}
        </Button>
      </div>
      {inPanel ? (
        <p className="px-2 py-2 text-2xs text-muted-foreground">Open beside the chat.</p>
      ) : (
        <AppFrame app={app} mode="inline" onMode={(m) => m === 'fullscreen' && panel.show({ id, app })} />
      )}
    </div>
  )
}

/** The panel beside the chat with the open app, full height. */
export function McpAppSidePanel() {
  const panel = useAppPanel()
  if (!panel.open) return null
  const { app } = panel.open
  return (
    <aside className="flex w-[min(48vw,720px)] min-w-80 shrink-0 flex-col border-s border-border bg-background">
      <div className="flex h-10 items-center gap-1.5 border-b border-border px-3 text-xs">
        <AppWindow className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium">{app.server}</span>
        <span className="min-w-0 truncate text-muted-foreground">{app.tool}</span>
        <Button variant="ghost" size="icon-sm" className="ms-auto" title="Close" aria-label="Close app" onClick={() => panel.show(null)}>
          <X className="size-3.5" />
        </Button>
      </div>
      <AppFrame app={app} mode="fullscreen" onMode={(m) => m === 'inline' && panel.show(null)} className="min-h-0 flex-1" />
    </aside>
  )
}

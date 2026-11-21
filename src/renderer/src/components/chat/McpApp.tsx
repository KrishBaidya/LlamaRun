import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, AppWindow, Loader2, Maximize2, Minimize2, PanelRightOpen, ShieldQuestion, X } from 'lucide-react'
import type { McpAppRef, McpAppResource } from '@shared/types'
import { appCsp } from '@shared/mcpApps'
import { TitleBar } from '@/components/TitleBar'
import { Button } from '@/components/ui/button'
import { api, useSettings } from '@/hooks/use-llamarun'
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
  /** The open app, the tool call it came from, and whether it is full screen (else beside the chat). */
  open: { id: string; app: McpAppRef; full: boolean } | null
  show(open: { id: string; app: McpAppRef; full: boolean } | null): void
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

/** How long after a click in an app it may still change how it's shown. */
const GESTURE_MS = 5000
const gestures = new WeakMap<HTMLIFrameElement, number>()

/**
 * Whether the user just clicked or typed in this app. A click in the frame
 * activates its parent page too (user activation), and focus moving into the
 * frame is noted, for keyboard use and as a fallback.
 */
function recentGesture(frame: HTMLIFrameElement | null): boolean {
  if (!frame) return false
  const focusedAt = gestures.get(frame) ?? 0
  const inFrame = document.activeElement === frame
  return (inFrame && navigator.userActivation?.isActive === true) || Date.now() - focusedAt < GESTURE_MS
}

/** One running view of an app. */
function AppFrame({
  app: given,
  mode,
  onMode,
  onClose,
  className
}: {
  app: McpAppRef
  mode: DisplayMode
  onMode: (m: DisplayMode) => void
  onClose?: () => void
  className?: string
}) {
  const { chatId } = useAppPanel()
  // The chat hands over a new object on every update; the view restarts only when the call itself differs.
  const key = JSON.stringify([given.server, given.uri, given.tool, given.args, given.result])
  const [app, setApp] = useState(given)
  useEffect(() => setApp(given), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const onModeRef = useRef(onMode)
  onModeRef.current = onMode
  const onCloseRef = useRef(onClose ?? (() => undefined))
  onCloseRef.current = onClose ?? (() => undefined)
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
      listTools: () => api.mcpApps.listTools(app.server),
      listResources: () => api.mcpApps.listResources(app.server),
      close: () => onCloseRef.current(),
      openLink: (url) => void api.app.openExternal(url),
      message: (text) => chatId && void api.mcpApps.message(chatId, app.server, text),
      setContext: (text) => chatId && void api.mcpApps.setContext(chatId, app.server, text),
      requestMode: (m) => (onModeRef.current(m), m),
      hasGesture: () => recentGesture(frame.current),
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
    const send = (): void =>
      bridge.current?.contextChanged({
        displayMode: mode,
        containerDimensions: mode === 'inline' ? { maxHeight: INLINE_MAX_HEIGHT } : { height: el?.clientHeight ?? 600, width: el?.clientWidth ?? 600 }
      })
    send()
    // In the panel or full screen the app fills a box that changes with the window.
    if (mode === 'inline' || !el) return
    const watch = new ResizeObserver(send)
    watch.observe(el)
    return () => watch.disconnect()
  }, [mode, resource])

  // Clicking into the app moves focus to its frame: noted, so it may change how it's shown for a few seconds.
  useEffect(() => {
    const onBlur = (): void => {
      if (document.activeElement === frame.current) gestures.set(frame.current!, Date.now())
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

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

/** Tool calls whose app the user allowed once, this session. */
const allowedOnce = new Set<string>()

/**
 * Before an app first shows, like Claude: Allow (this one) or Always allow
 * (every app from this server, saved in settings). The tool's text result is
 * in the card either way.
 */
function Consent({ id, app, children }: { id: string; app: McpAppRef; children: ReactNode }) {
  const [settings, update] = useSettings()
  const [, rerender] = useState(0)
  if (!settings) return null
  const trusted = settings.mcpAppsTrusted?.includes(app.server)
  if (trusted || allowedOnce.has(id)) return <>{children}</>
  return (
    <div className="flex flex-wrap items-center gap-2 px-2.5 py-2 text-xs">
      <ShieldQuestion className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        Show the <b>{app.server}</b> app here? It runs that server&apos;s own page in a sandbox and can use its tools.
      </span>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => (allowedOnce.add(id), rerender((n) => n + 1))}>
        Allow
      </Button>
      <Button size="sm" className="h-7 text-xs" onClick={() => void update({ mcpAppsTrusted: [...(settings.mcpAppsTrusted ?? []), app.server] })}>
        Always allow
      </Button>
    </div>
  )
}

/** An app under its tool card in a reply; its buttons move it beside the chat or full screen. */
export function McpAppInline({ id, app }: { id: string; app: McpAppRef }) {
  const panel = useAppPanel()
  const elsewhere = panel.open?.id === id
  return (
    <div className="overflow-hidden rounded-lg border border-border/70">
      <div className="flex items-center gap-1.5 border-b border-border/70 bg-card px-2 py-1 text-2xs text-muted-foreground">
        <AppWindow className="size-3" />
        <span className="min-w-0 truncate">{app.server}</span>
        <Button variant="ghost" size="sm" className="ms-auto h-6 px-1.5 text-2xs" onClick={() => panel.show(elsewhere ? null : { id, app, full: false })}>
          <PanelRightOpen className="size-3" /> {elsewhere ? 'Close' : 'Open beside chat'}
        </Button>
        {!elsewhere && (
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-2xs" title="Full screen" aria-label="Full screen" onClick={() => panel.show({ id, app, full: true })}>
            <Maximize2 className="size-3" />
          </Button>
        )}
      </div>
      <Consent id={id} app={app}>
        {elsewhere ? (
          <p className="px-2 py-2 text-2xs text-muted-foreground">{panel.open?.full ? 'Open full screen.' : 'Open beside the chat.'}</p>
        ) : (
          // The app asking for full screen opens it beside the chat, as Claude does.
          <AppFrame app={app} mode="inline" onMode={(m) => m === 'fullscreen' && panel.show({ id, app, full: false })} />
        )}
      </Consent>
    </div>
  )
}

function AppHeader({ app, children }: { app: McpAppRef; children: ReactNode }) {
  return (
    <>
      <AppWindow className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-medium">{app.server}</span>
      <span className="min-w-0 truncate text-muted-foreground">{app.tool}</span>
      <span className="ms-auto flex shrink-0 items-center gap-0.5">{children}</span>
    </>
  )
}

/** The panel beside the chat with the open app, full height. Expands to full screen from its title bar. */
export function McpAppSidePanel() {
  const panel = useAppPanel()
  if (!panel.open || panel.open.full) return null
  const { id, app } = panel.open
  return (
    <aside className="flex w-[min(48vw,720px)] min-w-80 shrink-0 flex-col border-s border-border bg-background">
      {/* A title bar like the chat's, so the window's own buttons don't cover these. */}
      <TitleBar className="border-b border-border text-xs">
        <AppHeader app={app}>
          <Button variant="ghost" size="icon-sm" className="no-drag" title="Full screen" aria-label="Full screen" onClick={() => panel.show({ id, app, full: true })}>
            <Maximize2 className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="no-drag" title="Close app" aria-label="Close app" onClick={() => panel.show(null)}>
            <X className="size-3.5" />
          </Button>
        </AppHeader>
      </TitleBar>
      <AppFrame app={app} mode="fullscreen" onMode={(m) => m === 'inline' && panel.show(null)} onClose={() => panel.show(null)} className="min-h-0 flex-1" />
    </aside>
  )
}

/**
 * Full screen: the app takes the messages' place, with the chat box still
 * below it so you can keep talking to the model. Otherwise the messages.
 */
export function McpAppFullScreen({ children }: { children: ReactNode }) {
  const panel = useAppPanel()
  if (!panel.open?.full) return <>{children}</>
  const { id, app } = panel.open
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-2 pb-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3 text-xs">
          <AppHeader app={app}>
            <Button variant="ghost" size="icon-sm" title="Back beside the chat" aria-label="Back beside the chat" onClick={() => panel.show({ id, app, full: false })}>
              <Minimize2 className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" title="Close app" aria-label="Close app" onClick={() => panel.show(null)}>
              <X className="size-3.5" />
            </Button>
          </AppHeader>
        </div>
        <AppFrame app={app} mode="fullscreen" onMode={(m) => m === 'inline' && panel.show(null)} onClose={() => panel.show(null)} className="min-h-0 flex-1" />
      </div>
    </div>
  )
}

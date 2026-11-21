import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { PluginAttachmentFile, PluginButtonContext, PluginButtonPlace, ToolPart } from '@shared/types'
import { PreviewFrame, RenderedBlock } from '@/components/HtmlPreview'
import { Button } from '@/components/ui/button'
import { useDebounced } from '@/hooks/use-llamarun'
import { usePluginSurfaces } from '@/hooks/use-plugin-surfaces'
import { cn } from '@/lib/utils'
import { Icon } from '@/plugin-kit/icons'

/**
 * What plugins add to the chat window (SDK 1.6): code blocks they draw,
 * buttons, status items, tool cards and attach-menu entries. Plugin code
 * never runs here: their HTML goes in the same sandboxed frame as an
 * ```html block, and clicks go back to the plugin through the main process.
 */

const api = (): typeof window.llamarun | undefined => (typeof window === 'undefined' ? undefined : window.llamarun)

function errorText(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

// ------------------------------------------------------------ code blocks

const drawn = new Map<string, Promise<string | null>>()

/** Each block is drawn once per text: re-renders and other windows reuse it. */
function drawBlock(language: string, code: string): Promise<string | null> {
  const key = `${language}\u0000${code}`
  let html = drawn.get(key)
  if (!html) {
    html = api()!.plugins.renderBlock(language, code)
    html.catch(() => drawn.delete(key))
    drawn.set(key, html)
    if (drawn.size > 200) drawn.delete(drawn.keys().next().value!)
  }
  return html
}

function PluginRenderedBlock({ language, label, code, pre }: { language: string; label: string; code: string; pre: ReactNode }) {
  // A block still streaming changes with every token: draw it once it settles.
  const settled = useDebounced(code, 400)
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    drawBlock(language, settled).then(
      (out) => live && (setHtml(out), setError(null)),
      (err: unknown) => live && (setHtml(null), setError(errorText(err)))
    )
    return () => {
      live = false
    }
  }, [language, settled])

  if (!html)
    return (
      <div className="relative">
        {pre}
        {error && <p className="-mt-1 mb-2 text-2xs text-destructive">{label}: {error}</p>}
      </div>
    )
  return (
    <RenderedBlock label={label} source={code} code={pre} framed large={<PreviewFrame html={html} fill className="h-full rounded-lg" />}>
      <PreviewFrame html={html} />
    </RenderedBlock>
  )
}

/** A fenced code block: drawn by the plugin that added its language, or shown as code. */
export function PluginCodeBlock({ language, code, pre }: { language: string | undefined; code: string; pre: ReactNode }) {
  const { renderers } = usePluginSurfaces()
  const renderer = language ? renderers.find((r) => r.language === language.toLowerCase()) : undefined
  if (!renderer) return <>{pre}</>
  return <PluginRenderedBlock language={renderer.language} label={renderer.label} code={code} pre={pre} />
}

// ---------------------------------------------------------------- buttons

/**
 * The buttons plugins put in one place. `context` is read at click time (the
 * draft changes); a composer button's returned text goes to `onInsert`.
 */
export function PluginButtons({
  where,
  context,
  onInsert,
  className
}: {
  where: PluginButtonPlace
  context: () => PluginButtonContext
  onInsert?: (text: string) => void
  className?: string
}) {
  const { buttons } = usePluginSurfaces()
  const [busy, setBusy] = useState<string | null>(null)
  const mine = buttons.filter((b) => b.where === where)
  if (!mine.length) return null
  const click = (plugin: string, id: string): void => {
    setBusy(`${plugin}:${id}`)
    api()!
      .plugins.clickButton(plugin, id, context())
      .then((text) => text && onInsert?.(text))
      .catch((err: unknown) => toast.error(errorText(err)))
      .finally(() => setBusy(null))
  }
  return (
    <>
      {mine.map((b) => {
        const title = `${b.tooltip ?? b.label} (${b.pluginName})`
        const pending = busy === `${b.plugin}:${b.id}`
        if (where === 'sidebar')
          return (
            <Button
              key={`${b.plugin}:${b.id}`}
              variant="ghost"
              className={cn('w-full justify-start text-muted-foreground', className)}
              title={title}
              disabled={pending}
              onClick={() => click(b.plugin, b.id)}
            >
              {b.icon && <Icon name={b.icon} />} {b.label}
            </Button>
          )
        return (
          <Button
            key={`${b.plugin}:${b.id}`}
            variant="ghost"
            size={b.icon ? 'icon-sm' : 'sm'}
            className={cn(where === 'composer' ? 'rounded-full text-muted-foreground hover:text-foreground' : 'h-7 text-2xs', !b.icon && 'px-2', className)}
            title={title}
            aria-label={b.label}
            disabled={pending}
            onClick={() => click(b.plugin, b.id)}
          >
            {b.icon ? <Icon name={b.icon} className={where === 'composer' ? 'size-4' : 'size-3.5'} /> : b.label}
          </Button>
        )
      })}
    </>
  )
}

// ----------------------------------------------------------- status items

/** Small items plugins show next to the chat box. */
export function PluginStatusItems({ className }: { className?: string }) {
  const { statusItems } = usePluginSurfaces()
  if (!statusItems.length) return null
  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      {statusItems.map((s) => {
        const body = (
          <>
            {s.icon && <Icon name={s.icon} className="size-3.5 shrink-0" />}
            {s.text && <span className="max-w-32 truncate">{s.text}</span>}
          </>
        )
        const title = `${s.tooltip ?? s.text} (${s.pluginName})`
        const cls = 'inline-flex h-7 items-center gap-1 rounded-full px-1.5 text-2xs text-muted-foreground'
        return s.clickable ? (
          <button
            key={`${s.plugin}:${s.id}`}
            type="button"
            title={title}
            className={cn(cls, 'hover:bg-accent hover:text-foreground')}
            onClick={() => void api()!.plugins.clickStatus(s.plugin, s.id).catch((err: unknown) => toast.error(errorText(err)))}
          >
            {body}
          </button>
        ) : (
          <span key={`${s.plugin}:${s.id}`} title={title} className={cls}>
            {body}
          </span>
        )
      })}
    </div>
  )
}

// -------------------------------------------------------------- tool cards

/** HTML for a tool call's card from the plugin that offers the tool, or null for the usual card. */
export function usePluginToolCard(part: ToolPart): string | null {
  const { toolCards } = usePluginSurfaces()
  const has = !!part.server && toolCards.some((c) => c.server === part.server && c.tool === part.name)
  const [html, setHtml] = useState<string | null>(null)
  const args = JSON.stringify(part.args ?? {})
  useEffect(() => {
    if (!has) {
      setHtml(null)
      return
    }
    let live = true
    const status = part.status === 'running' ? 'running' : part.status === 'error' ? 'error' : 'done'
    api()!
      .plugins.renderToolCard(part.server!, part.name, { args: JSON.parse(args) as Record<string, unknown>, result: part.result, status })
      .then(
        (out) => live && setHtml(out),
        () => live && setHtml(null)
      )
    return () => {
      live = false
    }
  }, [has, part.server, part.name, part.status, part.result, args])
  return html
}

export function PluginToolCardBody({ html }: { html: string }) {
  return <PreviewFrame html={html} className="rounded-b-lg" />
}

// ---------------------------------------------------------- attach menu

function toFile(f: PluginAttachmentFile): File {
  if (f.text !== undefined) return new File([f.text], f.name, { type: f.mimeType })
  const binary = atob(f.data ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], f.name, { type: f.mimeType })
}

/** Asks a plugin's attach-menu entry for its files, as File objects for the chat box. */
export async function filesFromSource(plugin: string, id: string, chatId: string | null): Promise<File[]> {
  return (await api()!.plugins.attach(plugin, id, chatId)).map(toFile)
}

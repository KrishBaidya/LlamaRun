import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, Code2, Copy, Eye, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const MIN_HEIGHT = 60
/** Stops a page that keeps growing with its frame (min-height: 110vh) from growing forever. */
const MAX_HEIGHT = 4000

/** A page sized to its window (100vh, a full-screen canvas) gets a 16:10-ish frame instead. */
function viewportHeight(width: number): number {
  return Math.round(Math.min(720, Math.max(420, width * 0.62)))
}

/**
 * html-preview.html in a sandboxed iframe (scripts on, same-origin off, so it
 * cannot reach the app). It reports its content height so the frame grows to
 * fit the whole page, the way Claude shows its inline widgets.
 */
function PreviewFrame({ html, fill, className }: { html: string; fill?: boolean; className?: string }) {
  const [height, setHeight] = useState(MIN_HEIGHT * 2)
  const frame = useRef<HTMLIFrameElement>(null)
  const id = useId()
  const loaded = useRef(false)

  useEffect(() => {
    const render = (): void => frame.current?.contentWindow?.postMessage({ type: 'render', id, html }, '*')
    const onMessage = (e: MessageEvent): void => {
      if (e.source !== frame.current?.contentWindow) return
      const data = e.data as { llamarunPreview?: string; height?: number; fillsViewport?: boolean }
      if (data?.llamarunPreview === 'ready') {
        loaded.current = true
        render()
      } else if (data?.llamarunPreview === id && typeof data.height === 'number') {
        const next = data.fillsViewport ? viewportHeight(frame.current?.clientWidth ?? 600) : data.height
        setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, next)))
      }
    }
    window.addEventListener('message', onMessage)
    // New HTML (a reply still streaming): start from a fresh page, which then asks for it.
    if (loaded.current) frame.current?.contentWindow?.location.replace(frame.current.src)
    return () => window.removeEventListener('message', onMessage)
  }, [html, id])

  return (
    <iframe
      ref={frame}
      title="HTML preview"
      src="html-preview.html"
      sandbox="allow-scripts allow-popups allow-forms allow-modals"
      className={cn('block w-full border-0 bg-white', className)}
      style={fill ? undefined : { height }}
    />
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="size-6"
      title="Copy source"
      aria-label="Copy source"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </Button>
  )
}

/**
 * Something a model drew (a page, a diagram, an SVG) shown as itself, with a
 * small toolbar on hover to see the source, copy it or open it large.
 */
export function RenderedBlock({
  label,
  source,
  code,
  children,
  large,
  framed
}: {
  label: string
  source: string
  /** The highlighted source, shown by the Code toggle. */
  code: ReactNode
  /** The rendered result. */
  children: ReactNode
  /** The rendered result for the expanded view. */
  large: ReactNode
  /** Pages get a border and their own background; diagrams sit on the message. */
  framed?: boolean
}) {
  const [mode, setMode] = useState<'preview' | 'code'>('preview')
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={cn('group/render relative my-3', (framed || mode === 'code') && 'overflow-hidden rounded-xl border border-border/70')}>
      {mode === 'preview' ? children : <div className="[&>pre]:m-0 [&>pre]:rounded-none [&>pre]:border-0">{code}</div>}
      <div
        className={cn(
          'absolute end-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-lg border border-border/70 bg-popover/95 p-0.5 shadow-sm backdrop-blur',
          'opacity-0 transition-opacity group-hover/render:opacity-100 focus-within:opacity-100',
          mode === 'code' && 'opacity-100'
        )}
      >
        <span className="px-1.5 text-2xs font-medium text-muted-foreground">{label}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          title={mode === 'preview' ? 'Show code' : 'Show preview'}
          aria-label={mode === 'preview' ? 'Show code' : 'Show preview'}
          onClick={() => setMode(mode === 'preview' ? 'code' : 'preview')}
        >
          {mode === 'preview' ? <Code2 className="size-3" /> : <Eye className="size-3" />}
        </Button>
        <CopyButton text={source} />
        <Button variant="ghost" size="icon-sm" className="size-6" title="Expand" aria-label="Expand" onClick={() => setExpanded(true)}>
          <Maximize2 className="size-3" />
        </Button>
      </div>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[85vh] w-[90vw] max-w-[90vw] flex-col gap-2 p-3 sm:max-w-[90vw]">
          <DialogTitle className="ps-1 text-sm">{label}</DialogTitle>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">{large}</div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** An ```html block shown as a live page that grows to fit its content. */
export function HtmlPreview({ html, code }: { html: string; code: ReactNode }) {
  return (
    <RenderedBlock label="HTML" source={html} code={code} framed large={<PreviewFrame html={html} fill className="h-full rounded-lg" />}>
      <PreviewFrame html={html} />
    </RenderedBlock>
  )
}

/** A picture in a message: click to see it full size. */
export function ZoomableImage({ src, alt, className }: { src: string; alt?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <img src={src} alt={alt ?? ''} title={alt} loading="lazy" className={cn('cursor-zoom-in', className)} onClick={() => setOpen(true)} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] w-auto max-w-[90vw] items-center justify-center p-2 sm:max-w-[90vw]">
          <DialogTitle className="sr-only">{alt || 'Image'}</DialogTitle>
          <img src={src} alt={alt ?? ''} className="max-h-[85vh] max-w-full rounded-lg object-contain" />
        </DialogContent>
      </Dialog>
    </>
  )
}

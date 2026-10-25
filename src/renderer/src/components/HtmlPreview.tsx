import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Code2, Eye, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const MIN_HEIGHT = 80
const MAX_HEIGHT = 640

/**
 * html-preview.html in a sandboxed iframe (scripts on, same-origin off, so it
 * cannot reach the app). It reports its height so the frame fits the page.
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
      const data = e.data as { llamarunPreview?: string; height?: number }
      if (data?.llamarunPreview === 'ready') {
        loaded.current = true
        render()
      } else if (data?.llamarunPreview === id && typeof data.height === 'number') {
        setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, data.height)))
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

/** An ```html or ```svg block shown live, with a toggle back to the highlighted source. */
export function HtmlPreview({ html, code, label = 'HTML' }: { html: string; code: ReactNode; label?: string }) {
  const [mode, setMode] = useState<'preview' | 'code'>('preview')
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="flex items-center gap-1 border-b border-border/70 px-2 py-1">
        <span className="ps-1 text-2xs font-medium text-muted-foreground">{label}</span>
        <div className="ms-auto flex items-center gap-0.5">
          <Button variant={mode === 'preview' ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-2xs" onClick={() => setMode('preview')}>
            <Eye className="size-3" /> Preview
          </Button>
          <Button variant={mode === 'code' ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-2xs" onClick={() => setMode('code')}>
            <Code2 className="size-3" /> Code
          </Button>
          <Button variant="ghost" size="icon-sm" className="size-6" title="Expand" aria-label="Expand preview" onClick={() => setExpanded(true)}>
            <Maximize2 className="size-3" />
          </Button>
        </div>
      </div>
      {mode === 'preview' ? <PreviewFrame html={html} /> : <div className="[&>pre]:m-0 [&>pre]:rounded-none [&>pre]:border-0">{code}</div>}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[85vh] w-[90vw] max-w-[90vw] flex-col gap-2 p-3 sm:max-w-[90vw]">
          <DialogTitle className="ps-1 text-sm">Preview</DialogTitle>
          <PreviewFrame html={html} fill className="min-h-0 flex-1 rounded-lg" />
        </DialogContent>
      </Dialog>
    </div>
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

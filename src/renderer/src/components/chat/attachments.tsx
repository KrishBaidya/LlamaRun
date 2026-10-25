import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { FileText, Loader2, Paperclip, X } from 'lucide-react'
import type { ChatAttachment } from '@shared/types'
import { ZoomableImage } from '@/components/HtmlPreview'
import { Button } from '@/components/ui/button'
import { api } from '@/hooks/use-llamarun'
import { ACCEPT, formatBytes, toAttachment } from '@/lib/attachments'
import { cn } from '@/lib/utils'

const MAX_IMAGES = 6

export interface AttachmentsState {
  items: ChatAttachment[]
  /** Files still being read. */
  pending: number
  error: string | null
  add: (files: Iterable<File>) => void
  remove: (id: string) => void
  clear: () => void
  /** Spread on the element that takes pasted and dropped files. */
  dropProps: {
    onPaste: (e: ClipboardEvent) => void
    onDragOver: (e: DragEvent) => void
    onDragLeave: (e: DragEvent) => void
    onDrop: (e: DragEvent) => void
  }
  dragging: boolean
}

/** Files attached to the message being written: picked, pasted or dropped. */
export function useAttachments(): AttachmentsState {
  const [items, setItems] = useState<ChatAttachment[]>([])
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const add = useCallback((files: Iterable<File>) => {
    setError(null)
    for (const file of files) {
      setPending((n) => n + 1)
      toAttachment(file)
        .then((a) =>
          setItems((list) => {
            if (a.kind === 'image' && list.filter((x) => x.kind === 'image').length >= MAX_IMAGES) {
              setError(`Attach up to ${MAX_IMAGES} images at a time`)
              return list
            }
            return [...list, a]
          })
        )
        .catch((err: unknown) => setError(String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')))
        .finally(() => setPending((n) => n - 1))
    }
  }, [])

  const remove = useCallback((id: string) => setItems((list) => list.filter((a) => a.id !== id)), [])
  const clear = useCallback(() => {
    setItems([])
    setError(null)
  }, [])

  const dropProps: AttachmentsState['dropProps'] = {
    onPaste: (e) => {
      const files = [...e.clipboardData.files]
      if (!files.length) return
      e.preventDefault()
      add(files)
    },
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
    },
    onDrop: (e) => {
      setDragging(false)
      if (!e.dataTransfer.files.length) return
      e.preventDefault()
      add(e.dataTransfer.files)
    }
  }

  return { items, pending, error, add, remove, clear, dropProps, dragging }
}

/** Paperclip button that opens the file picker. */
export function AttachButton({ onFiles, className }: { onFiles: (files: File[]) => void; className?: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn('rounded-full text-muted-foreground hover:text-foreground', className)}
        title="Attach images or documents"
        aria-label="Attach files"
        onClick={() => {
          // The overlay hides when it loses focus; the file picker would close it otherwise.
          void api.overlay.holdOpen()
          input.current?.click()
        }}
      >
        <Paperclip className="size-4" />
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={ACCEPT}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
    </>
  )
}

/** One attachment: an image thumbnail or a document card. */
export function AttachmentTile({ a, onRemove, large }: { a: ChatAttachment; onRemove?: () => void; large?: boolean }) {
  const meta = [a.pages ? `${a.pages} page${a.pages === 1 ? '' : 's'}` : null, formatBytes(a.size), a.truncated ? 'cut to fit' : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="group/tile relative">
      {a.kind === 'image' && a.dataUrl ? (
        onRemove ? (
          <img src={a.dataUrl} alt={a.name} title={a.name} className="size-14 rounded-xl border border-border/70 object-cover" />
        ) : (
          <ZoomableImage
            src={a.dataUrl}
            alt={a.name}
            className={cn('rounded-xl border border-border/70 object-cover', large ? 'max-h-72 max-w-full' : 'size-24')}
          />
        )
      ) : (
        <div className="flex h-14 max-w-60 items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 text-left" title={a.name}>
          <FileText className="size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{a.name}</div>
            <div className="truncate text-2xs text-muted-foreground">{meta}</div>
          </div>
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${a.name}`}
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/tile:opacity-100 hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

/** The attachments row above the prompt, with a spinner while files are read. */
export function AttachmentStrip({ state, className }: { state: AttachmentsState; className?: string }) {
  if (!state.items.length && !state.pending && !state.error) return null
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(state.items.length > 0 || state.pending > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {state.items.map((a) => (
            <AttachmentTile key={a.id} a={a} onRemove={() => state.remove(a.id)} />
          ))}
          {state.pending > 0 && (
            <span className="flex h-14 items-center gap-2 rounded-xl border border-dashed px-3 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Reading…
            </span>
          )}
        </div>
      )}
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
    </div>
  )
}

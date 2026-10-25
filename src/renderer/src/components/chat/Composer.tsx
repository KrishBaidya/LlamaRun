import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import type { ChatAttachment } from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AttachButton, AttachmentStrip, useAttachments } from './attachments'
import { SlashMenu, useSlashMenu } from './slash'

export interface ComposerHandle {
  focus: () => void
}

interface Props {
  busy: boolean
  onSend: (text: string, attachments: ChatAttachment[]) => Promise<unknown> | void
  onStop: () => void
  placeholder?: string
  /** Left side of the toolbar row (model picker etc). */
  toolbar?: ReactNode
  /** Right side of the toolbar, before the send button (context usage). */
  status?: ReactNode
  onEscape?: () => void
  autoFocus?: boolean
  className?: string
  /** Larger text for the "hero" empty state. */
  size?: 'default' | 'hero'
}

/** T3 Code-style glass composer: rounded card, auto-growing prompt, attachments, / commands, round send button. */
export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { busy, onSend, onStop, placeholder = 'Ask anything…', toolbar, status, onEscape, autoFocus, className, size = 'default' },
  ref
) {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const files = useAttachments()
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), [])

  const send = (value: string, attachments: ChatAttachment[]): void => {
    setText('')
    files.clear()
    void onSend(value, attachments)
  }
  const slash = useSlashMenu(text, setText, (command) => send(command, []))
  const canSend = (!!text.trim() || files.items.length > 0) && !files.pending

  const submit = (): void => {
    if (!canSend || busy) return
    send(text.trim(), files.items)
  }

  return (
    <div
      {...files.dropProps}
      className={cn(
        'glass relative mx-auto w-full max-w-3xl rounded-3xl border border-(--composer-outline) shadow-composer transition-colors focus-within:border-ring/40',
        files.dragging && 'border-primary/60 bg-primary/5',
        className
      )}
    >
      <SlashMenu menu={slash} className="absolute inset-x-2 bottom-full z-10 mb-2" />
      <AttachmentStrip state={files} className="px-3 pt-3" />
      <textarea
        ref={input}
        value={text}
        autoFocus={autoFocus}
        rows={1}
        spellCheck
        placeholder={files.dragging ? 'Drop to attach' : placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (slash.onKeyDown(e)) return
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            if (busy) onStop()
            else onEscape?.()
          }
        }}
        className={cn(
          'block max-h-60 min-h-11 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 outline-none [field-sizing:content] placeholder:text-muted-foreground',
          size === 'hero' ? 'text-lg' : 'text-sm'
        )}
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <AttachButton onFiles={files.add} />
        <div className="flex min-w-0 flex-1 items-center gap-1">{toolbar}</div>
        {status}
        {busy ? (
          <Button size="icon-sm" className="rounded-full" title="Stop (Esc)" onClick={onStop}>
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button size="icon-sm" className="rounded-full" title="Send (Enter)" disabled={!canSend} onClick={submit}>
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
})

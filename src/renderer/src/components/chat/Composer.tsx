import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import type { ChatAttachment } from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PluginButtons } from '@/components/plugins/surfaces'
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
  /** While busy: Enter queues the text (sent when the reply ends) instead of being ignored. */
  onQueue?: (text: string) => void
  /** Shown above the prompt (the queued messages). */
  above?: ReactNode
  /** Show what plugins added to the chat box: toolbar buttons and attach-menu entries (SDK 1.6). */
  plugins?: boolean
  /** The chat it writes in, for plugins' buttons; null before the chat exists. */
  chatId?: string | null
}

/** T3 Code-style glass composer: rounded card, auto-growing prompt, attachments, / commands, round send button. */
export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { busy, onSend, onStop, placeholder = 'Ask anything…', toolbar, status, onEscape, autoFocus, className, size = 'default', onQueue, above, plugins, chatId },
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
    if (!canSend) return
    if (busy) {
      // Files can't go into a running reply; they wait in the box.
      if (!onQueue || files.items.length || !text.trim()) return
      onQueue(text.trim())
      setText('')
      return
    }
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
      {above}
      <AttachmentStrip state={files} className="px-3 pt-3" />
      <textarea
        ref={input}
        value={text}
        autoFocus={autoFocus}
        rows={1}
        spellCheck
        placeholder={files.dragging ? 'Drop to attach' : busy && onQueue ? 'Add a follow-up: it is sent when the reply finishes' : placeholder}
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
        <AttachButton onFiles={files.add} plugins={plugins} chatId={chatId} />
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {toolbar}
          {plugins && (
            <PluginButtons
              where="composer"
              context={() => ({ chatId: chatId ?? null, draft: text })}
              onInsert={(t) => {
                setText((prev) => (prev ? `${prev}${/\s$/.test(prev) ? '' : ' '}${t}` : t))
                input.current?.focus()
              }}
            />
          )}
        </div>
        {status}
        {busy && onQueue && text.trim() && !files.items.length && (
          <Button size="icon-sm" variant="secondary" className="rounded-full" title="Queue (Enter): sent when the reply finishes" onClick={submit}>
            <ArrowUp className="size-4" />
          </Button>
        )}
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

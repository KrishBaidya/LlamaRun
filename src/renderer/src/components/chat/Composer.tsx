import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ComposerHandle {
  focus: () => void
}

interface Props {
  busy: boolean
  onSend: (text: string) => Promise<unknown> | void
  onStop: () => void
  placeholder?: string
  /** Left side of the toolbar row (model picker etc). */
  toolbar?: ReactNode
  onEscape?: () => void
  autoFocus?: boolean
  className?: string
  /** Larger text for the "hero" empty state. */
  size?: 'default' | 'hero'
}

/** T3 Code-style glass composer: rounded card, auto-growing prompt, round send button. */
export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { busy, onSend, onStop, placeholder = 'Ask anything…', toolbar, onEscape, autoFocus, className, size = 'default' },
  ref
) {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), [])

  const submit = (): void => {
    const value = text.trim()
    if (!value || busy) return
    setText('')
    void onSend(value)
  }

  return (
    <div
      className={cn(
        'glass relative mx-auto w-full max-w-3xl rounded-3xl border border-(--composer-outline) shadow-composer transition-colors focus-within:border-ring/40',
        className
      )}
    >
      <textarea
        ref={input}
        value={text}
        autoFocus={autoFocus}
        rows={1}
        spellCheck
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
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
        <div className="flex min-w-0 flex-1 items-center gap-1">{toolbar}</div>
        {busy ? (
          <Button size="icon-sm" className="rounded-full" title="Stop (Esc)" onClick={onStop}>
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button size="icon-sm" className="rounded-full" title="Send (Enter)" disabled={!text.trim()} onClick={submit}>
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
})

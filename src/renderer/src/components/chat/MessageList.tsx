import { memo, useEffect, useRef, useState } from 'react'
import { AlertCircle, Bot, Check, Copy, Mic, Play, RotateCcw, Sparkles, Wand2, Wrench } from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/hooks/use-llamarun'
import { cn } from '@/lib/utils'
import { modelName, useModelCatalog } from './ModelPicker'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="group flex flex-col items-end gap-1">
      <div className="relative flex max-w-[80%] items-start">
        <span className="absolute top-1 -left-9 opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={message.content} />
        </span>
        <div className="rounded-2xl bg-message px-3.5 py-2 whitespace-pre-wrap" data-selectable>
          {message.content}
        </div>
      </div>
      {message.via && (
        <span className="inline-flex items-center gap-1 pe-1 text-2xs text-muted-foreground">
          {message.via.voice ? <Mic className="size-3" /> : <Bot className="size-3" />}
          {message.via.voice ? `Spoken to ${message.via.plugin}` : `Sent by ${message.via.plugin}`}
        </span>
      )}
      {message.prompt && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 pe-1 text-2xs text-muted-foreground">
              <Wand2 className="size-3" /> Rewritten by a plugin
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm whitespace-pre-wrap">{message.prompt}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function ErrorCallout({ message, onRetry }: { message: ChatMessage; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/8 px-3.5 py-2.5 text-sm">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 space-y-2">
        <p data-selectable>{message.error}</p>
        <div className="flex flex-wrap gap-1.5">
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCcw /> Retry
            </Button>
          )}
          {message.errorCode === 'OLLAMA_UNAVAILABLE' && (
            <Button size="sm" variant="outline" onClick={() => void api.app.openExternal('https://ollama.com/download')}>
              Get Ollama
            </Button>
          )}
          {message.errorCode === 'NOT_AUTHENTICATED' && (
            <Button size="sm" variant="outline" onClick={() => void api.auth.signIn()}>
              Sign in
            </Button>
          )}
          {(message.errorCode === 'NO_MODEL' || message.errorCode === 'OLLAMA_UNAVAILABLE' || message.errorCode === 'NOT_AUTHENTICATED') && (
            <Button size="sm" variant="ghost" onClick={() => void api.app.openSettings('/')}>
              Choose another model
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function ToolLimitCallout({ message, onContinue }: { message: ChatMessage; onContinue?: () => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3.5 py-2.5 text-sm">
      <Wrench className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-muted-foreground">
        {message.note ?? 'Paused at the tool-call limit'}. Continue picks up where it stopped.
      </p>
      {onContinue && (
        <Button size="sm" variant="outline" onClick={onContinue}>
          <Play /> Continue
        </Button>
      )}
    </div>
  )
}

const AssistantMessage = memo(function AssistantMessage({
  message,
  isLast,
  busy,
  onRetry,
  onContinue
}: {
  message: ChatMessage
  isLast: boolean
  busy?: boolean
  onRetry?: () => void
  onContinue?: () => void
}) {
  const catalog = useModelCatalog()
  const streaming = message.status === 'streaming'
  return (
    <div className="group flex flex-col gap-2">
      {message.tools?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {message.tools.map((t, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-card px-2 py-0.5 text-2xs text-muted-foreground"
            >
              <Wrench className="size-3" />
              {t.server ? `${t.server} › ` : ''}
              {t.name}
            </span>
          ))}
        </div>
      ) : null}

      {message.content ? (
        <Markdown text={message.content} />
      ) : streaming ? (
        <span className="shimmer-text w-fit text-sm">{message.tools?.length ? 'Using tools…' : 'Thinking…'}</span>
      ) : null}

      {message.status === 'error' && <ErrorCallout message={message} onRetry={isLast ? onRetry : undefined} />}
      {message.toolLimit && isLast && <ToolLimitCallout message={message} onContinue={busy ? undefined : onContinue} />}
      {message.status === 'cancelled' && (
        <p className="text-xs text-muted-foreground italic">{message.note ?? 'Stopped'}</p>
      )}

      {!streaming && (message.content || isLast) && (
        <div
          className={cn(
            'flex items-center gap-0.5 text-2xs text-muted-foreground transition-opacity',
            isLast ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          {message.content && <CopyButton text={message.content} />}
          {isLast && onRetry && message.status !== 'error' && (
            <Button variant="ghost" size="icon-sm" title="Regenerate" onClick={onRetry}>
              <RotateCcw className="size-3.5" />
            </Button>
          )}
          {message.model && (
            <span className="ms-1 inline-flex items-center gap-1">
              <Sparkles className="size-3" />
              {modelName(catalog, message.model)}
            </span>
          )}
        </div>
      )}
    </div>
  )
})

/**
 * Thread timeline in T3 Code's layout: centered column, user turns as
 * right-aligned bubbles, assistant turns as plain full-width markdown.
 */
export function MessageList({
  messages,
  busy,
  onRetry,
  onContinue,
  className,
  compact
}: {
  messages: ChatMessage[]
  busy: boolean
  onRetry?: () => void
  onContinue?: () => void
  className?: string
  compact?: boolean
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const last = messages[messages.length - 1]
  const lastLength = last?.content.length ?? 0

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages.length, lastLength, busy])

  // New turn from the user: always jump to the bottom.
  useEffect(() => {
    if (last?.role === 'user') stick.current = true
  }, [last?.id, last?.role])

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      }}
      className={cn('min-h-0 flex-1 overflow-y-auto', compact ? 'px-4' : 'px-5', className)}
    >
      <div className={cn('mx-auto flex w-full max-w-3xl flex-col', compact ? 'gap-4 py-3' : 'gap-6 py-6')}>
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <UserMessage key={m.id} message={m} />
          ) : (
            <AssistantMessage
              key={m.id}
              message={m}
              isLast={i === messages.length - 1}
              busy={busy}
              onRetry={onRetry}
              onContinue={onContinue}
            />
          )
        )}
        {busy && last?.role === 'user' && <span className="shimmer-text w-fit text-sm">Thinking…</span>}
      </div>
    </div>
  )
}

import { Fragment, memo, useEffect, useRef, useState } from 'react'
import { AlertCircle, Blocks, Bot, Check, ChevronDown, Copy, FoldVertical, Mic, Play, RotateCcw, ShieldQuestion, Sparkles, Wand2, Wrench } from 'lucide-react'
import type { ApprovalRequest, ChatCompaction, ChatMessage } from '@shared/types'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, useProfile } from '@/hooks/use-llamarun'
import { cn } from '@/lib/utils'
import { AttachmentTile } from './attachments'
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
  const attachments = message.attachments ?? []
  return (
    <div className="group flex flex-col items-end gap-1">
      {attachments.length > 0 && (
        <div className="flex max-w-[80%] flex-wrap justify-end gap-2">
          {attachments.map((a) => (
            <AttachmentTile key={a.id} a={a} />
          ))}
        </div>
      )}
      {message.content && (
        <div className="relative flex max-w-[80%] items-start">
          <span className="absolute top-1 -left-9 opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton text={message.content} />
          </span>
          <div className="rounded-2xl bg-message px-3.5 py-2 whitespace-pre-wrap" data-selectable>
            {message.content}
          </div>
        </div>
      )}
      {message.skill && (
        <span className="inline-flex items-center gap-1 pe-1 text-2xs text-muted-foreground">
          <Sparkles className="size-3" /> Ran the {message.skill.name} skill
        </span>
      )}
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

/** Extra line under a plan or quota error explaining the way out. */
function planHint(message: ChatMessage, pro: boolean, resets: string | null): string | null {
  if (message.errorCode === 'PLAN_REQUIRED') {
    return 'Upgrade to LlamaRun Pro to use this model, or pick a free one.'
  }
  if (message.errorCode === 'QUOTA_EXCEEDED') {
    const when = resets ? ` Your allowance resets on ${resets}.` : ''
    return pro
      ? `You’ve used this month’s cloud messages.${when} Local Ollama models keep working.`
      : `You’ve used this month’s free cloud messages.${when} Upgrade to Pro for more, or use a local Ollama model.`
  }
  return null
}

function ErrorCallout({ message, onRetry }: { message: ChatMessage; onRetry?: () => void }) {
  const code = message.errorCode
  const planError = code === 'PLAN_REQUIRED' || code === 'QUOTA_EXCEEDED'
  const profile = useProfile()
  const pro = profile?.plan?.tier === 'pro'
  const periodEnd = profile?.usage?.periodEnd
  const resets = periodEnd && !Number.isNaN(Date.parse(periodEnd)) ? new Date(periodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null
  const hint = planError ? planHint(message, pro, resets) : null
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/8 px-3.5 py-2.5 text-sm">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 space-y-2">
        <p data-selectable>{message.error}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        <div className="flex flex-wrap gap-1.5">
          {planError && !(code === 'QUOTA_EXCEEDED' && pro) && (
            <Button size="sm" onClick={() => void api.account.openUpgrade()}>
              <Sparkles /> Upgrade
            </Button>
          )}
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCcw /> Retry
            </Button>
          )}
          {code === 'OLLAMA_UNAVAILABLE' && (
            <Button size="sm" variant="outline" onClick={() => void api.app.openExternal('https://ollama.com/download')}>
              Get Ollama
            </Button>
          )}
          {code === 'NOT_AUTHENTICATED' && (
            <Button size="sm" variant="outline" onClick={() => void api.auth.signIn()}>
              Sign in
            </Button>
          )}
          {(code === 'NO_MODEL' || code === 'OLLAMA_UNAVAILABLE' || code === 'NOT_AUTHENTICATED' || planError) && (
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

      {message.from && (
        <span className="inline-flex w-fit items-center gap-1.5 text-2xs text-muted-foreground">
          <Blocks className="size-3" /> From {message.from.plugin}
        </span>
      )}

      {message.content ? (
        <Markdown text={message.content} />
      ) : streaming ? (
        <span className="shimmer-text w-fit text-sm">{message.tools?.length ? 'Using tools…' : 'Thinking…'}</span>
      ) : null}

      {message.attachments?.length ? (
        <div className="flex flex-wrap gap-2">
          {message.attachments.map((a) => (
            <AttachmentTile key={a.id} a={a} large />
          ))}
        </div>
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
          {message.model && !message.from && (
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

/** The model wants to run something on this PC: allow it once, always, or not at all (like Claude Code). */
function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const answer = (a: 'once' | 'always' | 'deny'): void => void api.chats.answerApproval(request.id, a)
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-primary/40 bg-primary/5 px-3.5 py-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <ShieldQuestion className="size-4 text-primary" /> {request.title}
      </div>
      <pre className="overflow-x-auto rounded-lg bg-background/80 px-3 py-2 font-mono text-xs whitespace-pre-wrap" data-selectable>
        {request.command}
      </pre>
      <p className="text-xs text-muted-foreground">{request.detail}</p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => answer('once')}>
          Allow once
        </Button>
        <Button size="sm" variant="outline" onClick={() => answer('always')}>
          {request.alwaysLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => answer('deny')}>
          Deny
        </Button>
      </div>
    </div>
  )
}

const formatTokens = (n: number): string => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))

/** Where older messages were summarised: the model sees the summary instead of everything above. */
function CompactionDivider({ compaction }: { compaction: ChatCompaction }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-2xs text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <span className="h-px flex-1 bg-border" />
        <FoldVertical className="size-3" />
        Conversation compacted · {formatTokens(compaction.tokensBefore)} → {formatTokens(compaction.tokensAfter)} tokens
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
        <span className="h-px flex-1 bg-border" />
      </button>
      {open && (
        <div className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm">
          <p className="mb-2 text-2xs text-muted-foreground">The model sees this summary instead of the messages above.</p>
          <Markdown text={compaction.summary} />
        </div>
      )}
    </div>
  )
}

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
  compact,
  compaction,
  compacting,
  approval
}: {
  messages: ChatMessage[]
  busy: boolean
  onRetry?: () => void
  onContinue?: () => void
  className?: string
  compact?: boolean
  compaction?: ChatCompaction
  compacting?: boolean
  approval?: ApprovalRequest | null
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const last = messages[messages.length - 1]
  const lastLength = last?.content.length ?? 0

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages.length, lastLength, busy, approval?.id])

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
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            {m.role === 'user' ? (
              <UserMessage message={m} />
            ) : (
              <AssistantMessage message={m} isLast={i === messages.length - 1} busy={busy} onRetry={onRetry} onContinue={onContinue} />
            )}
            {compaction?.throughMessageId === m.id && <CompactionDivider compaction={compaction} />}
          </Fragment>
        ))}
        {approval && <ApprovalCard request={approval} />}
        {compacting ? (
          <span className="shimmer-text inline-flex w-fit items-center gap-1.5 text-sm">
            <FoldVertical className="size-3.5" /> Compacting conversation…
          </span>
        ) : (
          busy && last?.role === 'user' && <span className="shimmer-text w-fit text-sm">Thinking…</span>
        )}
      </div>
    </div>
  )
}

import { Fragment, memo, useEffect, useRef, useState } from 'react'
import { AlertCircle, Blocks, Bot, Brain, Check, ChevronDown, Copy, FoldVertical, Loader2, MessageCircleQuestion, Mic, Play, RotateCcw, ShieldQuestion, Sparkles, Wand2, Wrench } from 'lucide-react'
import type { ApprovalAnswer, ApprovalRequest, ChatCompaction, ChatMessage, ToolPart } from '@shared/types'
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

/** A short hint of what a tool call was about: its first text argument ("notepad", "ctrl+s"). */
function argHint(args: ToolPart['args']): string {
  const value = Object.values(args ?? {}).find((v) => typeof v === 'string' && v.trim()) as string | undefined
  if (!value) return ''
  const line = value.replace(/\s+/g, ' ').trim()
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

/** One tool call in a reply, where it happened: name and status, with its input and result a click away. */
/** The model's thinking between tool calls: its first line (Gemini titles each thought), the rest on click. */
function ThinkingNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const trimmed = text.trim()
  if (!trimmed) return null
  const title = trimmed.split('\n')[0].replace(/\*\*/g, '').trim()
  return (
    <div className="w-full max-w-full text-xs text-muted-foreground">
      <button type="button" className="flex w-full min-w-0 items-center gap-1.5 text-left hover:text-foreground" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Brain className="size-3 shrink-0" />
        <span className="min-w-0 truncate italic">{title}</span>
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="mt-1 border-s border-border ps-3 opacity-90"><Markdown text={trimmed} /></div>}
    </div>
  )
}

function ToolCard({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false)
  const hint = argHint(part.args)
  const hasArgs = part.args && Object.keys(part.args).length > 0
  return (
    <div className="w-full max-w-full rounded-lg border border-border/70 bg-card text-2xs">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {part.status === 'running' ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : part.status === 'error' ? (
          <AlertCircle className="size-3 shrink-0 text-destructive" />
        ) : (
          <Wrench className="size-3 shrink-0" />
        )}
        <span className="shrink-0">
          {part.server ? `${part.server} › ` : ''}
          <span className="font-medium text-foreground">{part.name}</span>
        </span>
        {hint && <span className="min-w-0 truncate opacity-80">{hint}</span>}
        <ChevronDown className={cn('ms-auto size-3 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-border/70 px-2 py-1.5">
          {hasArgs && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-muted-foreground">
              {JSON.stringify(part.args, null, 2)}
            </pre>
          )}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono">
            {part.result ?? (part.status === 'running' ? 'Running…' : '')}
          </pre>
        </div>
      )}
    </div>
  )
}

const AssistantMessage = memo(function AssistantMessage({
  chatId,
  message,
  isLast,
  busy,
  onRetry,
  onContinue
}: {
  chatId?: string
  message: ChatMessage
  isLast: boolean
  busy?: boolean
  onRetry?: () => void
  onContinue?: () => void
}) {
  const catalog = useModelCatalog()
  const streaming = message.status === 'streaming'
  // Replies with parts show text and tool calls in the order they happened; older ones keep the chip row.
  const parts = message.parts?.length ? message.parts : null
  const lastTodo = parts?.filter((p): p is ToolPart => p.type === 'tool' && p.name === 'todo_update').at(-1)?.id
  return (
    <div className="group flex flex-col gap-2">
      {!parts && message.tools?.length ? (
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

      {parts ? (
        <>
          {parts.map((p, i) =>
            p.type === 'tool' ? (
              p.name === 'todo_update' ? (
                // Only the latest list is drawn; earlier updates are replaced by it.
                p.id === lastTodo ? <TodoList key={p.id} part={p} /> : null
              ) : (
                <ToolCard key={p.id} part={p} />
              )
            ) : p.type === 'thinking' ? (
              <ThinkingNote key={i} text={p.text} />
            ) : p.text.trim() ? (
              <Markdown key={i} text={p.text} />
            ) : null
          )}
          {streaming && parts[parts.length - 1]?.type === 'tool' && (parts[parts.length - 1] as ToolPart).status !== 'running' && (
            <span className="shimmer-text w-fit text-sm">Thinking…</span>
          )}
        </>
      ) : message.content ? (
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

      {chatId && message.changedFiles?.length && !streaming ? <ChangedFiles chatId={chatId} message={message} /> : null}
      {message.undoneFiles ? (
        <p className="text-xs text-muted-foreground italic">
          Undid the changes to {message.undoneFiles} file{message.undoneFiles === 1 ? '' : 's'}.
        </p>
      ) : null}
      {chatId && message.suggestions && !streaming && <SuggestionsCard chatId={chatId} message={message} />}

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
/** The user's files a reply changed with its file tools, and the way back. */
function ChangedFiles({ chatId, message }: { chatId: string; message: ChatMessage }) {
  const [error, setError] = useState<string | null>(null)
  const files = message.changedFiles!
  const name = (p: string): string => p.split(/[\\/]/).pop() ?? p
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <span title={files.join('\n')}>
          Changed {files.length === 1 ? name(files[0]) : `${files.length} files`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          title="Put the originals back and remove files this reply created. Changes made by commands or scripts aren't included."
          onClick={() => api.chats.undoFiles(chatId, message.id).catch((e: unknown) => setError(String(e instanceof Error ? e.message : e)))}
        >
          <RotateCcw className="size-3" /> Undo file changes
        </Button>
      </div>
      {error && <p className="text-destructive">{error}</p>}
    </div>
  )
}

/** What the review after a long task proposes keeping. Nothing is kept until the user clicks. */
function SuggestionsCard({ chatId, message }: { chatId: string; message: ChatMessage }) {
  const [error, setError] = useState<string | null>(null)
  const s = message.suggestions!
  const keep = (what: 'skill' | number | 'dismiss'): void => {
    setError(null)
    api.chats.keepSuggestion(chatId, message.id, what).catch((e: unknown) => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)))
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card px-3.5 py-3 text-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Sparkles className="size-3.5" /> Keep for next time?
      </div>
      {s.skill && (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Skill: {s.skill.name}</p>
            <p className="text-xs text-muted-foreground">{s.skill.description}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => keep('skill')}>
            Save skill
          </Button>
        </div>
      )}
      {s.memories?.map((m, i) => (
        <div key={m.text} className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-xs">
            <span className="text-muted-foreground">{m.kind === 'user' ? 'About you: ' : 'Note: '}</span>
            {m.text}
          </p>
          <Button size="sm" variant="outline" onClick={() => keep(i)}>
            Remember
          </Button>
        </div>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button size="sm" variant="ghost" className="w-fit" onClick={() => keep('dismiss')}>
        Dismiss
      </Button>
    </div>
  )
}

/** The model's to-do list (todo_update): only its latest version is drawn, where it was last updated. */
function TodoList({ part }: { part: ToolPart }) {
  const items = (Array.isArray(part.args?.items) ? part.args.items : []) as { text?: string; status?: string }[]
  if (!items.length) return null
  return (
    <div className="flex w-full max-w-full flex-col gap-1 rounded-lg border border-border/70 bg-card px-3 py-2 text-xs">
      {items.map((item, i) => (
        <div key={i} className={cn('flex items-start gap-2', item.status === 'done' && 'text-muted-foreground line-through')}>
          {item.status === 'done' ? (
            <Check className="mt-0.5 size-3 shrink-0" />
          ) : item.status === 'in_progress' ? (
            <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" />
          ) : (
            <span className="mt-0.5 size-3 shrink-0 rounded-full border border-muted-foreground/60" />
          )}
          <span className="min-w-0">{item.text}</span>
        </div>
      ))}
    </div>
  )
}

/** The model asks the user to choose (ask_user): an option, an answer of their own, or no answer. */
function QuestionCard({ request }: { request: ApprovalRequest }) {
  const [text, setText] = useState('')
  const reply = (answer: string): void => void api.chats.answerQuestion(request.id, answer)
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-primary/40 bg-primary/5 px-3.5 py-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <MessageCircleQuestion className="size-4 text-primary" /> {request.title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(request.options ?? []).map((option) => (
          <Button key={option} size="sm" variant="outline" onClick={() => reply(option)}>
            {option}
          </Button>
        ))}
      </div>
      {request.other && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) reply(text.trim())
          }}
        >
          <input
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
            placeholder="Or type your answer"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={!text.trim()}>
            Send
          </Button>
        </form>
      )}
      <Button size="sm" variant="ghost" className="w-fit" onClick={() => void api.chats.answerApproval(request.id, 'deny')}>
        Skip
      </Button>
    </div>
  )
}

function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const answer = (a: ApprovalAnswer): void => void api.chats.answerApproval(request.id, a)
  if (request.kind === 'question') return <QuestionCard request={request} />
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
        {request.chatLabel && (
          <Button size="sm" variant="outline" onClick={() => answer('chat')}>
            {request.chatLabel}
          </Button>
        )}
        {request.alwaysLabel && (
          <Button size="sm" variant="outline" onClick={() => answer('always')}>
            {request.alwaysLabel}
          </Button>
        )}
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
  chatId,
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
  chatId?: string
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
              <AssistantMessage chatId={chatId} message={m} isLast={i === messages.length - 1} busy={busy} onRetry={onRetry} onContinue={onContinue} />
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

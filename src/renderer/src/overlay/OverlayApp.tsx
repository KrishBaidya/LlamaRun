import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { ArrowUp, LoaderCircle, Maximize2, Settings2, Sparkles, SquarePen, Square } from 'lucide-react'
import type { ChatSummary } from '@shared/types'
import { MessageList } from '@/components/chat/MessageList'
import { ModelButton } from '@/components/chat/ModelPicker'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useChat, useChatList } from '@/hooks/use-chat'
import { api, useIpcEvent, useSettings } from '@/hooks/use-llamarun'
import { cn, relativeTime } from '@/lib/utils'

const RECENT_COUNT = 5
/** Input row and footer, which stay visible while the conversation scrolls. */
const CHROME_HEIGHT = 56 + 8 + 40 + 2

/**
 * The hotkey overlay, Spotlight-style: a bar near the top of the screen. It stays a
 * single line plus recent chats until you ask something, then grows down with the
 * answer. The window follows the content's height (see windows/overlay.ts).
 */
export function OverlayApp() {
  const [settings] = useSettings()
  const [chatId, setChatId] = useState<string | null>(null)
  const [draftModel, setDraftModel] = useState('')
  const [opacity, setOpacity] = useState(15)
  const [minHeight, setMinHeight] = useState(360)
  const [maxHeight, setMaxHeight] = useState(560)
  /** The model dropdown (its own window, so the bar keeps its size) is open. */
  const [menuOpen, setMenuOpen] = useState(false)
  const menuClosedAt = useRef(0)
  const modelButton = useRef<HTMLButtonElement>(null)
  /** Recent chat picked with the arrow keys; -1 = none. */
  const [picked, setPicked] = useState(-1)
  const input = useRef<InputHandle>(null)
  const root = useRef<HTMLDivElement>(null)

  const onCreated = useCallback((id: string) => {
    setChatId(id)
    void api.overlay.setChat(id)
  }, [])
  const { chat, busy, send, stop, retry, resume, error } = useChat(chatId, onCreated)
  const recent = useChatList()?.slice(0, RECENT_COUNT) ?? []

  useEffect(() => {
    if (settings) {
      setOpacity(settings.appOpacity)
      setDraftModel((m) => m || settings.selectedModel)
    }
  }, [settings])

  const focusInput = (): void => void requestAnimationFrame(() => input.current?.focus())

  useIpcEvent(
    'overlay:shown',
    useCallback((p) => {
      setOpacity(p.opacity)
      setMinHeight(p.minHeight)
      setMaxHeight(p.maxHeight)
      setChatId(p.chatId)
      setPicked(-1)
      focusInput()
    }, [])
  )

  // The window is exactly as tall as this content.
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const report = (): void => void api.overlay.resize(Math.ceil(el.getBoundingClientRect().height))
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const open = useCallback((id: string | null) => {
    setChatId(id)
    setPicked(-1)
    void api.overlay.setChat(id)
    focusInput()
  }, [])

  const openInChats = useCallback(() => void api.app.openChat(chat?.id ?? null), [chat?.id])

  useIpcEvent(
    'overlay:modelMenu',
    useCallback((p) => {
      setMenuOpen(false)
      menuClosedAt.current = Date.now()
      if (p.chosen) setModelRef.current(p.chosen)
      focusInput()
    }, [])
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        open(null)
      } else if (e.key.toLowerCase() === 'o') {
        e.preventDefault()
        openInChats()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openInChats])

  const model = chat?.model || draftModel
  const setModel = (m: string): void => {
    if (chat) void api.chats.setModel(chat.id, m)
    else setDraftModel(m)
  }
  const setModelRef = useRef(setModel)
  setModelRef.current = setModel

  const toggleModelMenu = (): void => {
    // Clicking the button while the menu is open closes the menu (by focusing the
    // overlay) just before this click arrives; don't reopen it straight away.
    if (menuOpen || Date.now() - menuClosedAt.current < 250) return
    const r = modelButton.current?.getBoundingClientRect()
    if (!r) return
    setMenuOpen(true)
    void api.modelMenu.open({ x: r.x, y: r.y, width: r.width, height: r.height }, model)
  }
  const hasThread = !!chat?.messages.length
  const showRecent = !hasThread && recent.length > 0

  /** Arrow keys walk the recent chats while the prompt is empty; Enter opens the picked one. */
  const onInputKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (!showRecent) return
    const empty = e.currentTarget.value === ''
    if (empty && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setPicked((i) => Math.max(-1, Math.min(recent.length - 1, i + step)))
    } else if (empty && e.key === 'Enter' && picked >= 0) {
      e.preventDefault()
      open(recent[picked].id)
    } else if (e.key === 'Escape' && picked >= 0) {
      e.preventDefault()
      setPicked(-1)
    } else if (e.key.length === 1) {
      setPicked(-1) // typing a question, not picking a chat
    }
  }

  return (
    <TooltipProvider>
      <div ref={root} className="relative isolate flex flex-col overflow-hidden" style={{ minHeight }}>
        {/* While a reply is generating, the brand gradient glows in from the top edge.
            Its strength is the "Animation Opacity" setting. */}
        <div
          aria-hidden
          className="loading-gradient pointer-events-none absolute inset-x-0 top-0 -z-10 h-48 [mask-image:linear-gradient(to_bottom,black_15%,transparent)]"
          style={{
            opacity: busy ? Math.min(1, (opacity / 100) * 1.6) : 0,
            transition: busy ? 'opacity 1.2s ease-out' : 'opacity .5s ease-in'
          }}
        />

        <SpotlightInput
          ref={input}
          busy={busy}
          placeholder={hasThread ? 'Ask a follow-up…' : 'Ask anything…'}
          onSend={(text) => send(text, model)}
          onStop={stop}
          onEscape={() => void api.overlay.hide()}
          onKeyDown={onInputKey}
          model={
            <ModelButton
              ref={modelButton}
              value={model}
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              className={cn(menuOpen && 'bg-accent text-foreground')}
              onClick={toggleModelMenu}
            />
          }
        />
        {error && <p className="border-t px-5 py-2 text-xs text-destructive">{error}</p>}

        {hasThread && (
          <div className="flex min-h-0 flex-1 flex-col border-t" style={{ maxHeight: Math.max(120, maxHeight - CHROME_HEIGHT) }}>
            <MessageList compact messages={chat!.messages} busy={busy} onRetry={retry} onContinue={resume} className="px-5" />
          </div>
        )}
        {showRecent && <RecentChats chats={recent} picked={picked} onOpen={open} onHover={setPicked} />}
        {!hasThread && !showRecent && (
          <p className="flex flex-1 items-center justify-center border-t px-5 text-sm text-muted-foreground">
            Your recent chats appear here.
          </p>
        )}

        <footer className="flex h-10 shrink-0 items-center gap-1 border-t ps-5 pe-2 text-xs text-muted-foreground">
          {hasThread ? (
            <span className="min-w-0 flex-1 truncate">{chat!.title}</span>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-4">
              <Hint keys={['↑', '↓']}>Recent chats</Hint>
              <Hint keys={['Esc']}>Hide</Hint>
            </span>
          )}
          {hasThread && (
            <FooterAction keys="Ctrl N" onClick={() => open(null)} icon={<SquarePen />}>
              New chat
            </FooterAction>
          )}
          <FooterAction keys="Ctrl O" onClick={openInChats} icon={<Maximize2 />}>
            Open in Chats
          </FooterAction>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            title="Settings"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => void api.app.openSettings('/')}
          >
            <Settings2 />
          </Button>
        </footer>
      </div>
    </TooltipProvider>
  )
}

interface InputHandle {
  focus: () => void
}

/** The bar itself: a borderless prompt that grows to a few lines, the model and send. */
const SpotlightInput = forwardRef<
  InputHandle,
  {
    busy: boolean
    placeholder: string
    model: ReactNode
    onSend: (text: string) => Promise<unknown> | void
    onStop: () => void
    onEscape: () => void
    onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  }
>(function SpotlightInput({ busy, placeholder, model, onSend, onStop, onEscape, onKeyDown }, ref) {
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }), [])

  const submit = (): void => {
    const value = text.trim()
    if (!value || busy) return
    setText('')
    void onSend(value)
  }

  return (
    <div className="flex min-h-16 shrink-0 items-start gap-3 ps-5 pe-3">
      <Sparkles className={cn('mt-5.75 size-[18px] shrink-0 text-primary', busy && 'animate-pulse')} aria-hidden />
      <textarea
        ref={area}
        value={text}
        autoFocus
        rows={1}
        spellCheck
        aria-label="Ask Llama Run"
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown(e)
          if (e.defaultPrevented) return
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            if (busy) onStop()
            else onEscape()
          }
        }}
        className="block max-h-32 min-w-0 flex-1 resize-none bg-transparent py-5 text-[17px] leading-[26px] outline-none [field-sizing:content] placeholder:text-muted-foreground"
      />
      <div className="mt-4.75 flex shrink-0 items-center gap-1.5">
        {model}
        {busy ? (
          <Button size="icon-sm" className="rounded-full" title="Stop (Esc)" aria-label="Stop" onClick={onStop}>
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button size="icon-sm" className="rounded-full" title="Send (Enter)" aria-label="Send" disabled={!text.trim()} onClick={submit}>
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
})

/** The same rows as the chat window's sidebar, picked with the arrow keys. */
function RecentChats({
  chats,
  picked,
  onOpen,
  onHover
}: {
  chats: ChatSummary[]
  picked: number
  onOpen: (id: string) => void
  onHover: (index: number) => void
}) {
  return (
    <section className="flex-1 border-t px-2.5 pt-2 pb-2" aria-label="Recent chats">
      <h2 className="px-2.5 pb-1 text-2xs font-medium text-sidebar-muted-foreground">Recent</h2>
      <div className="flex flex-col gap-px" role="listbox" onMouseLeave={() => onHover(-1)}>
        {chats.map((c, i) => (
          <button
            key={c.id}
            role="option"
            aria-selected={picked === i}
            onClick={() => onOpen(c.id)}
            onMouseEnter={() => onHover(i)}
            className={cn(
              'relative flex h-8 shrink-0 items-center gap-3 rounded-control px-2.5 text-left text-sm transition-colors',
              picked === i && 'bg-sidebar-row-selected before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary'
            )}
          >
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            {c.generating ? (
              <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{relativeTime(c.updatedAt)}</span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}

function FooterAction({ keys, icon, onClick, children }: { keys: string; icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      title={`${children} (${keys.replace(' ', '+')})`}
      className="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
    >
      {icon}
      {children}
    </Button>
  )
}

function Hint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex gap-0.5">
        {keys.map((k) => (
          <kbd key={k} className="rounded-[3px] border bg-card px-1 font-sans text-2xs leading-4 text-foreground/80">
            {k}
          </kbd>
        ))}
      </span>
      {children}
    </span>
  )
}

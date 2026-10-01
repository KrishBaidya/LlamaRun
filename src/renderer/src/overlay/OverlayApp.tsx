import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquare, PanelRightOpen, Settings2, SquarePen } from 'lucide-react'
import { Composer, type ComposerHandle } from '@/components/chat/Composer'
import { MessageList } from '@/components/chat/MessageList'
import { ModelPicker } from '@/components/chat/ModelPicker'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useChat, useChatList } from '@/hooks/use-chat'
import { api, useIpcEvent, useSettings } from '@/hooks/use-llamarun'
import { cn, relativeTime } from '@/lib/utils'
import { Keycaps } from '../settings/HotkeyRecorder'

export function OverlayApp() {
  const [settings] = useSettings()
  const [chatId, setChatId] = useState<string | null>(null)
  const [draftModel, setDraftModel] = useState('')
  const [opacity, setOpacity] = useState(15)
  const composer = useRef<ComposerHandle>(null)

  const onCreated = useCallback((id: string) => {
    setChatId(id)
    void api.overlay.setChat(id)
  }, [])
  const { chat, busy, send, stop, retry, resume, error } = useChat(chatId, onCreated)
  const recent = useChatList()?.slice(0, 5) ?? []

  useEffect(() => {
    if (settings) {
      setOpacity(settings.appOpacity)
      setDraftModel((m) => m || settings.selectedModel)
    }
  }, [settings])

  useIpcEvent(
    'overlay:shown',
    useCallback((p) => {
      setOpacity(p.opacity)
      setChatId(p.chatId)
      requestAnimationFrame(() => composer.current?.focus())
    }, [])
  )

  const newChat = useCallback(() => {
    setChatId(null)
    void api.overlay.setChat(null)
    requestAnimationFrame(() => composer.current?.focus())
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newChat])

  const model = chat?.model || draftModel
  const setModel = (m: string): void => {
    if (chat) void api.chats.setModel(chat.id, m)
    else setDraftModel(m)
  }
  const hasThread = !!chat?.messages.length
  const hide = (): void => void api.overlay.hide()

  const composerEl = (
    <Composer
      ref={composer}
      busy={busy}
      autoFocus
      size={hasThread ? 'default' : 'hero'}
      placeholder={hasThread ? 'Ask a follow-up…' : 'Ask Anything!'}
      onSend={(text) => send(text, model)}
      onStop={stop}
      onEscape={hide}
      toolbar={<ModelPicker value={model} onChange={setModel} />}
    />
  )

  return (
    <TooltipProvider>
      <div className="relative flex h-full flex-col overflow-hidden">
        <div
          aria-hidden
          className="loading-gradient pointer-events-none absolute inset-0"
          style={{
            opacity: busy ? opacity / 100 : 0,
            transition: busy ? 'opacity 3s ease-in' : 'opacity .4s'
          }}
        />

        {/* Header: drag handle + actions */}
        <header className="drag relative flex h-10 shrink-0 items-center gap-2 ps-4 pe-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            {hasThread ? chat!.title : 'Llama Run'}
          </span>
          <div className="no-drag flex items-center">
            <Button variant="ghost" size="icon-sm" title="New chat (Ctrl+N)" onClick={newChat} disabled={!hasThread}>
              <SquarePen className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" title="Open in Chats" onClick={() => void api.app.openChat(chat?.id ?? null)}>
              <PanelRightOpen className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" title="Settings" onClick={() => void api.app.openSettings('/')}>
              <Settings2 className="size-4" />
            </Button>
          </div>
        </header>

        {hasThread ? (
          <>
            <MessageList compact messages={chat!.messages} busy={busy} onRetry={retry} onContinue={resume} className="relative" />
            <div className="relative px-4 pb-3">
              {error && <p className="mx-auto mb-2 max-w-3xl px-2 text-xs text-destructive">{error}</p>}
              {composerEl}
            </div>
          </>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col px-4 pt-1 pb-3">
            {composerEl}
            {error && <p className="mx-auto mt-2 w-full max-w-3xl px-2 text-xs text-destructive">{error}</p>}
            {recent.length > 0 && (
              <div className="mx-auto mt-4 flex min-h-0 w-full max-w-3xl flex-col overflow-y-auto">
                <div className="px-2.5 pb-1 text-2xs font-medium text-muted-foreground">Recent chats</div>
                {recent.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setChatId(c.id)
                      void api.overlay.setChat(c.id)
                    }}
                    className="flex h-8 shrink-0 items-center gap-2.5 rounded-control px-2.5 text-left text-sm transition-colors hover:bg-sidebar-row-hover"
                  >
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <span className="shrink-0 text-2xs text-muted-foreground">{relativeTime(c.updatedAt)}</span>
                  </button>
                ))}
              </div>
            )}
            <div
              className={cn(
                'mx-auto mt-auto flex w-full max-w-3xl shrink-0 pt-3 flex-wrap items-center justify-center gap-x-4 gap-y-1 text-2xs text-muted-foreground'
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <Keycaps accelerator="Enter" /> send
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Keycaps accelerator="Shift+Enter" /> new line
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Keycaps accelerator="CommandOrControl+N" /> new chat
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Keycaps accelerator="Esc" /> hide
              </span>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

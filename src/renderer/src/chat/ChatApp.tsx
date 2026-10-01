import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { Composer, type ComposerHandle } from '@/components/chat/Composer'
import { MessageList } from '@/components/chat/MessageList'
import { ModelPicker } from '@/components/chat/ModelPicker'
import { TitleBar } from '@/components/TitleBar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useChat, useChatList } from '@/hooks/use-chat'
import { api, useIpcEvent, useSettings } from '@/hooks/use-llamarun'
import { ChatSidebar } from './ChatSidebar'

function initialChatId(): string | null {
  const m = /^#\/c\/(.+)$/.exec(window.location.hash)
  return m ? decodeURIComponent(m[1]) : null
}

export function ChatApp() {
  const [settings] = useSettings()
  const chats = useChatList()
  const [chatId, setChatId] = useState<string | null>(initialChatId)
  const [draftModel, setDraftModel] = useState('')
  const composer = useRef<ComposerHandle>(null)

  const select = useCallback((id: string | null) => {
    setChatId(id)
    history.replaceState(null, '', id ? `#/c/${encodeURIComponent(id)}` : '#/')
    requestAnimationFrame(() => composer.current?.focus())
  }, [])

  const { chat, busy, send, stop, retry, resume, error } = useChat(chatId, select)

  useEffect(() => {
    if (settings) setDraftModel((m) => m || settings.selectedModel)
  }, [settings])

  useIpcEvent(
    'chat:open',
    useCallback((id: string | null) => select(id), [select])
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        select(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select])

  const model = chat?.model || draftModel
  const setModel = (m: string): void => {
    if (chat) void api.chats.setModel(chat.id, m)
    else setDraftModel(m)
  }
  const hasThread = !!chat?.messages.length

  const composerEl = (
    <Composer
      ref={composer}
      busy={busy}
      autoFocus
      size={hasThread ? 'default' : 'hero'}
      placeholder={hasThread ? 'Reply…' : 'Ask anything…'}
      onSend={(text) => send(text, model)}
      onStop={stop}
      toolbar={<ModelPicker value={model} onChange={setModel} />}
    />
  )

  return (
    <TooltipProvider>
      <div className="flex h-full">
        <ChatSidebar chats={chats} activeId={chatId} onSelect={select} onNew={() => select(null)} />
        <main className="flex min-w-0 flex-1 flex-col">
          <TitleBar>
            <span className="min-w-0 truncate text-sm font-medium">{hasThread ? chat!.title : 'New chat'}</span>
          </TitleBar>

          {hasThread ? (
            <>
              <MessageList messages={chat!.messages} busy={busy} onRetry={retry} onContinue={resume} />
              <div className="px-5 pb-5">
                {error && <p className="mx-auto mb-2 max-w-3xl px-2 text-xs text-destructive">{error}</p>}
                {composerEl}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 pb-[12vh]">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-linear-to-br from-[#ff00cc]/80 to-[#333399]/80 text-white shadow-lg">
                  <MessageSquare className="size-5" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">What can I help with?</h1>
              </div>
              {composerEl}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}
        </main>
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}

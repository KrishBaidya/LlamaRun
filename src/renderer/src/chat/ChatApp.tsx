import { useCallback, useEffect, useRef, useState } from 'react'
import { FoldVertical, MessageSquare } from 'lucide-react'
import type { ChatAttachment, ChatSetup, ThinkingChoice } from '@shared/types'
import { PlanToggle } from '@/components/chat/PlanToggle'
import { McpAppFullScreen, McpAppPanelProvider, McpAppSidePanel } from '@/components/chat/McpApp'
import { ProjectPicker } from '@/components/chat/ProjectPicker'
import { Composer, type ComposerHandle } from '@/components/chat/Composer'
import { ContextRing } from '@/components/chat/ContextRing'
import { MessageList } from '@/components/chat/MessageList'
import { ModelPicker } from '@/components/chat/ModelPicker'
import { QueuedMessages } from '@/components/chat/QueuedMessages'
import { ThinkingPicker } from '@/components/chat/ThinkingPicker'
import { PluginStatusItems } from '@/components/plugins/surfaces'
import { TitleBar } from '@/components/TitleBar'
import { Button } from '@/components/ui/button'
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
  const [draftThinking, setDraftThinking] = useState<ThinkingChoice | undefined>()
  const [draftSetup, setDraftSetup] = useState<ChatSetup>({})
  const composer = useRef<ComposerHandle>(null)

  const select = useCallback((id: string | null) => {
    setChatId(id)
    history.replaceState(null, '', id ? `#/c/${encodeURIComponent(id)}` : '#/')
    requestAnimationFrame(() => composer.current?.focus())
  }, [])

  const { chat, busy, compacting, approval, send, compact, stop, retry, resume, error, queued, queue, steer, unqueue } = useChat(chatId, select)

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
  // Before the chat exists, the choice waits here and goes with its first message.
  const thinking = chat ? chat.thinking : draftThinking
  const setThinking = (t: ThinkingChoice | undefined): void => {
    if (chat) void api.chats.setThinking(chat.id, t ?? null)
    else setDraftThinking(t)
  }
  const plan = chat ? !!chat.plan : !!draftSetup.plan
  const setPlan = (p: boolean): void => {
    if (chat) void api.chats.setPlan(chat.id, p)
    else setDraftSetup((s) => ({ ...s, plan: p }))
  }
  const project = chat ? chat.project : draftSetup.project
  const setProject = (folder: string | undefined): void => {
    if (chat) void api.chats.setProject(chat.id, folder ?? null)
    else setDraftSetup((s) => ({ ...s, project: folder }))
  }
  const recentProjects = [...new Set((chats ?? []).map((c) => c.project).filter((p): p is string => !!p))]
  const hasThread = !!chat?.messages.length
  const onSend = (text: string, attachments: ChatAttachment[]): Promise<unknown> | void => {
    if (/^\/new\s*$/i.test(text)) return select(null)
    return send(text, model, attachments, chat ? undefined : draftThinking, chat ? undefined : draftSetup)
  }
  const last = chat?.messages[chat.messages.length - 1]
  const version = `${chat?.id}:${chat?.messages.length}:${last?.status}:${chat?.compaction?.createdAt ?? 0}`

  const composerEl = (
    <Composer
      ref={composer}
      busy={busy}
      autoFocus
      size={hasThread ? 'default' : 'hero'}
      placeholder={hasThread ? 'Reply…' : 'Ask anything…'}
      onSend={onSend}
      onStop={stop}
      onQueue={chat ? queue : undefined}
      plugins
      chatId={chat?.id ?? null}
      above={<QueuedMessages items={queued} busy={busy} onSteer={steer} onRemove={unqueue} />}
      toolbar={
        <>
          <ModelPicker value={model} onChange={setModel} />
          <ThinkingPicker model={model} value={thinking} onChange={setThinking} />
          <ProjectPicker value={project} recent={recentProjects} onChange={setProject} />
          <PlanToggle value={plan} onChange={setPlan} />
        </>
      }
      status={
        <>
          <PluginStatusItems />
          <ContextRing chatId={hasThread ? chat!.id : null} model={model} version={version} onCompact={() => void compact()} />
        </>
      }
    />
  )

  return (
    <TooltipProvider>
      <McpAppPanelProvider chatId={hasThread ? chat!.id : null}>
      <div className="flex h-full">
        <ChatSidebar chats={chats} activeId={chatId} onSelect={select} onNew={() => select(null)} />
        <main className="flex min-w-0 flex-1 flex-col">
          <TitleBar>
            <span className="min-w-0 truncate text-sm font-medium">{hasThread ? chat!.title : 'New chat'}</span>
            {hasThread && (
              <Button
                variant="ghost"
                size="sm"
                className="no-drag ms-auto h-7 text-xs text-muted-foreground"
                title="Summarise older messages to free up context (/compact)"
                disabled={busy}
                onClick={() => void compact()}
              >
                <FoldVertical className="size-3.5" /> Compact
              </Button>
            )}
          </TitleBar>

          {hasThread ? (
            <>
              <McpAppFullScreen>
                <MessageList
                  chatId={chat!.id}
                  messages={chat!.messages}
                  busy={busy}
                  onRetry={retry}
                  onContinue={resume}
                  compaction={chat!.compaction}
                  compacting={compacting}
                  approval={approval}
                />
              </McpAppFullScreen>
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
        <McpAppSidePanel />
      </div>
      </McpAppPanelProvider>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}

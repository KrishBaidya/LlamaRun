import { useCallback, useEffect, useRef, useState } from 'react'
import type { Chat, ChatEvent, ChatMessage, ChatSummary } from '@shared/types'
import { api } from './use-llamarun'

function applyEvent(chat: Chat, e: ChatEvent): Chat {
  switch (e.type) {
    case 'chat':
      return e.chat
    case 'message':
      return chat.messages.some((m) => m.id === e.message.id)
        ? chat
        : { ...chat, messages: [...chat.messages, e.message] }
    case 'update': {
      const exists = chat.messages.some((m) => m.id === e.message.id)
      return {
        ...chat,
        messages: exists
          ? chat.messages.map((m) => (m.id === e.message.id ? e.message : m))
          : [...chat.messages, e.message]
      }
    }
    case 'delta':
      return {
        ...chat,
        messages: chat.messages.map((m) => (m.id === e.messageId ? { ...m, content: m.content + e.text } : m))
      }
    case 'tool':
      return {
        ...chat,
        messages: chat.messages.map((m) => (m.id === e.messageId ? { ...m, tools: [...(m.tools ?? []), e.tool] } : m))
      }
  }
}

const eventChatId = (e: ChatEvent): string => (e.type === 'chat' ? e.chat.id : e.chatId)

export interface UseChat {
  chat: Chat | null
  /** A reply is being produced (including while plugins run, before the first token). */
  busy: boolean
  send: (text: string, model?: string) => Promise<string | null>
  stop: () => void
  retry: () => void
  /** Resumes a reply that stopped at the tool-round cap. */
  resume: () => void
  error: string | null
}

/**
 * Live view of one chat. `chatId` null means "new chat"; the first send creates
 * it and reports the new id through `onCreated`.
 */
export function useChat(chatId: string | null, onCreated?: (id: string) => void): UseChat {
  const [chat, setChat] = useState<Chat | null>(null)
  const [awaitingReply, setAwaitingReply] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idRef = useRef(chatId)
  /** Id of a chat this hook just created by sending; switching to it keeps the pending state. */
  const createdRef = useRef<string | null>(null)
  idRef.current = chatId

  useEffect(() => {
    setError(null)
    // A new chat (null) never starts out waiting; only the chat this hook just created keeps the flag.
    if (!chatId || chatId !== createdRef.current) setAwaitingReply(false)
    createdRef.current = null
    if (!chatId) {
      setChat(null)
      return
    }
    let alive = true
    void api.chats.get(chatId).then((c) => alive && setChat(c))
    return () => {
      alive = false
    }
  }, [chatId])

  useEffect(
    () =>
      api.on('chat:event', (e) => {
        if (eventChatId(e) !== idRef.current) return
        if (e.type === 'message' && e.message.role === 'assistant') setAwaitingReply(false)
        setChat((c) => (c ? applyEvent(c, e) : e.type === 'chat' ? e.chat : c))
      }),
    []
  )

  const streaming = chat?.messages.some((m) => m.status === 'streaming') ?? false
  // Waiting only counts until an assistant message (of any status) follows the last user turn.
  const last = chat?.messages[chat.messages.length - 1]
  const waiting = awaitingReply && (!last || last.role === 'user')

  // The reply's first event can arrive before send() learns the new chat's id, so the
  // listener above misses it. Clear the flag once the reply shows up in the chat instead,
  // or it lingers and a later new chat looks like it's generating.
  useEffect(() => {
    if (awaitingReply && last?.role === 'assistant') setAwaitingReply(false)
  }, [awaitingReply, last?.role])

  const send = useCallback(
    async (text: string, model?: string) => {
      setError(null)
      try {
        setAwaitingReply(true)
        const id = await api.chats.send(idRef.current, text, model)
        if (id !== idRef.current) {
          idRef.current = id
          createdRef.current = id
          onCreated?.(id)
        }
        return id
      } catch (err) {
        setAwaitingReply(false)
        setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '') : String(err))
        return null
      }
    },
    [onCreated]
  )

  const stop = useCallback(() => {
    if (idRef.current) void api.chats.cancel(idRef.current)
  }, [])

  const retry = useCallback(() => {
    if (idRef.current) {
      setAwaitingReply(true)
      void api.chats.retry(idRef.current)
    }
  }, [])

  const resume = useCallback(() => {
    if (idRef.current) void api.chats.continue(idRef.current)
  }, [])

  return { chat, busy: streaming || waiting, send, stop, retry, resume, error }
}

export function useChatList(): ChatSummary[] | null {
  const [list, setList] = useState<ChatSummary[] | null>(null)
  useEffect(() => {
    void api.chats.list().then(setList)
    return api.on('chats:changed', setList)
  }, [])
  return list
}

export function lastAssistant(chat: Chat | null): ChatMessage | undefined {
  return chat ? [...chat.messages].reverse().find((m) => m.role === 'assistant') : undefined
}

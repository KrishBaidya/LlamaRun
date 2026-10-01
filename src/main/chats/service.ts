import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { Chat, ChatEvent, ChatMessage, ChatSummary } from '@shared/types'
import { generate, GenerationError, mcpToolBridge, MAX_TOOL_ROUNDS, type HistoryMessage, type ToolPause } from '../llm'
import { pluginHost } from '../plugins/host'
import { settings } from '../settings'
import { chatStore, titleFrom } from './store'

const FLUSH_MS = 16

/** How one turn runs, for messages a plugin sends (a voice assistant, say). */
export interface TurnOptions {
  /** Instructions for this turn only, e.g. "replies are read aloud". Not shown or saved. */
  system?: string
  /** Offer the MCP tools. Defaults to true. */
  tools?: boolean
}

export interface SendOptions {
  model?: string
  /** Shown on the user message: which plugin sent it, and whether it was spoken. */
  via?: ChatMessage['via']
  turn?: TurnOptions
  /** A new chat created for this message is kept in memory only. */
  ephemeral?: boolean
}

/** Conversation the model sees: user turns (as sent) and completed assistant turns. */
export function historyFor(messages: ChatMessage[]): HistoryMessage[] {
  return messages
    .filter((m) => m.role === 'user' || (m.status === 'done' && m.content))
    .map((m) => ({ role: m.role, content: m.role === 'user' ? (m.prompt ?? m.content) : m.content }))
}

/**
 * Runs chat turns: plugin before-hooks -> model (with MCP tools) -> after-hooks.
 * One generation per chat at a time; every change is emitted as a ChatEvent so
 * the overlay and chat window stay in sync when showing the same thread.
 */
class ChatService extends EventEmitter<{ event: [ChatEvent]; changed: [ChatSummary[]] }> {
  private running = new Map<string, AbortController>()
  /** Replies stopped at the tool-round cap, per chat: the message and where it stopped. */
  private paused = new Map<string, { messageId: string; pause: ToolPause; turn?: TurnOptions }>()

  constructor() {
    super()
    chatStore.on('changed', () => this.emit('changed', this.list()))
  }

  list(): ChatSummary[] {
    return chatStore.summaries((id) => this.running.has(id))
  }

  get(id: string): Chat | null {
    return chatStore.get(id) ?? null
  }

  create(model?: string, ephemeral = false): Chat {
    return chatStore.create(model || settings.get('selectedModel'), ephemeral)
  }

  rename(id: string, title: string): void {
    const chat = chatStore.get(id)
    if (!chat) return
    chat.title = title.trim() || chat.title
    chatStore.save(chat, false)
    this.emit('event', { type: 'chat', chat })
  }

  setModel(id: string, model: string): void {
    const chat = chatStore.get(id)
    if (!chat) return
    chat.model = model
    chatStore.save(chat, false)
    this.emit('event', { type: 'chat', chat })
  }

  delete(id: string): void {
    this.cancel(id)
    this.paused.delete(id)
    chatStore.delete(id)
  }

  cancel(id: string): void {
    this.running.get(id)?.abort()
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  send(chatId: string | null, text: string, model?: string): string {
    return this.start(chatId, text, { model }).chatId
  }

  /**
   * Sends a message and resolves with the finished assistant message. The
   * turn streams to the chat windows like a typed one; follow `event`s for
   * `chatId` to watch it.
   */
  ask(chatId: string | null, text: string, options: SendOptions = {}): { chatId: string; done: Promise<ChatMessage> } {
    return this.start(chatId, text, options)
  }

  private start(chatId: string | null, text: string, options: SendOptions): { chatId: string; done: Promise<ChatMessage> } {
    const content = text.trim()
    if (!content) throw new Error('Message is empty')
    const existing = chatId ? chatStore.get(chatId) : undefined
    if (chatId && !existing && options.via) throw new Error(`No chat with id ${chatId}`)
    const chat = existing || this.create(options.model, options.ephemeral)
    if (this.running.has(chat.id)) throw new Error('Wait for the current response to finish, or stop it first.')
    if (!chat.model) chat.model = settings.get('selectedModel')
    // A plugin may pick the model per message; typed messages use the chat's model.
    if (existing && options.via && options.model) chat.model = options.model
    this.dropPause(chat)

    const user: ChatMessage = { id: randomUUID(), role: 'user', content, status: 'done', createdAt: Date.now() }
    if (options.via) user.via = options.via
    if (!chat.messages.length) chat.title = titleFrom(content)
    chat.messages.push(user)
    chatStore.save(chat)
    this.emit('event', { type: 'chat', chat })
    return { chatId: chat.id, done: this.run(chat, user, undefined, options.turn) }
  }

  retry(chatId: string): void {
    const chat = chatStore.get(chatId)
    if (!chat || this.running.has(chatId)) return
    const idx = chat.messages.map((m) => m.role).lastIndexOf('user')
    if (idx < 0) return
    const user = chat.messages[idx]
    this.dropPause(chat)
    chat.messages = chat.messages.slice(0, idx + 1)
    user.prompt = undefined
    chatStore.save(chat)
    this.emit('event', { type: 'chat', chat })
    void this.run(chat, user)
  }

  /**
   * Carries on a reply that stopped at the tool-round cap. It runs the tool
   * calls the model had asked for and sends the saved conversation once, so
   * nothing already done is repeated (unlike sending "continue").
   */
  continue(chatId: string): Promise<ChatMessage> | null {
    const chat = chatStore.get(chatId)
    const paused = this.paused.get(chatId)
    if (!chat || !paused || this.running.has(chatId)) return null
    const assistant = chat.messages[chat.messages.length - 1]
    const user = chat.messages.findLast((m) => m.role === 'user')
    if (assistant?.id !== paused.messageId || !user) {
      this.dropPause(chat)
      return null
    }
    this.paused.delete(chatId)
    assistant.toolLimit = undefined
    assistant.note = undefined
    assistant.status = 'streaming'
    return this.run(chat, user, { assistant, pause: paused.pause }, paused.turn)
  }

  /** A new message or retry makes a paused run stale. */
  private dropPause(chat: Chat): void {
    const paused = this.paused.get(chat.id)
    if (!paused) return
    this.paused.delete(chat.id)
    const message = chat.messages.find((m) => m.id === paused.messageId)
    if (message) {
      message.toolLimit = undefined
      message.note = undefined
    }
  }

  private async run(
    chat: Chat,
    user: ChatMessage,
    resume?: { assistant: ChatMessage; pause: ToolPause },
    turn?: TurnOptions
  ): Promise<ChatMessage> {
    const controller = new AbortController()
    this.running.set(chat.id, controller)
    this.emit('changed', this.list())

    const assistant: ChatMessage = resume?.assistant ?? {
      id: randomUUID(),
      role: 'assistant',
      content: '',
      status: 'streaming',
      model: chat.model,
      createdAt: Date.now()
    }
    const prior = assistant.content
    let pause: ToolPause | undefined
    const emitUpdate = (): void => {
      this.emit('event', { type: 'update', chatId: chat.id, message: { ...assistant } })
    }

    let pending = ''
    let timer: NodeJS.Timeout | null = null
    const flush = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      if (pending) this.emit('event', { type: 'delta', chatId: chat.id, messageId: assistant.id, text: pending })
      pending = ''
    }

    try {
      if (!chat.model) throw new GenerationError('No model selected. Choose one in Settings.', 'NO_MODEL')

      // A continued reply already went through the before-hooks.
      const before = resume
        ? { cancel: false, cancelled_by: undefined, input_text: user.prompt ?? user.content, model: resume.pause.model }
        : await pluginHost.beforeTextGeneration(user.content, chat.model)
      if (before.cancel) {
        assistant.status = 'cancelled'
        assistant.note = before.cancelled_by ? `Cancelled by ${before.cancelled_by}` : 'Cancelled by a plugin'
        chat.messages.push(assistant)
        this.emit('event', { type: 'message', chatId: chat.id, message: { ...assistant } })
        return { ...assistant }
      }
      if (!resume && before.input_text !== user.content) {
        user.prompt = before.input_text
        this.emit('event', { type: 'update', chatId: chat.id, message: { ...user } })
      }
      const model = before.model || chat.model
      assistant.model = model

      if (resume) emitUpdate()
      else {
        chat.messages.push(assistant)
        this.emit('event', { type: 'message', chatId: chat.id, message: { ...assistant } })
      }

      const text = await generate(historyFor(chat.messages.slice(0, -1)), {
        model,
        signal: controller.signal,
        tools: turn?.tools === false ? undefined : mcpToolBridge(),
        system: turn?.system,
        resume: resume?.pause,
        onPause: (p) => {
          pause = p
        },
        onToken: (t) => {
          assistant.content += t
          pending += t
          timer ??= setTimeout(flush, FLUSH_MS)
        },
        onTool: (name, server) => {
          flush()
          const tool = { name, server }
          assistant.tools = [...(assistant.tools ?? []), tool]
          this.emit('event', { type: 'tool', chatId: chat.id, messageId: assistant.id, tool })
        }
      })
      flush()

      if (controller.signal.aborted) {
        assistant.status = 'cancelled'
        assistant.note = 'Stopped'
        return { ...assistant }
      }
      assistant.content = prior + text
      if (pause) {
        // Stopped at the cap; after-hooks run once the reply is finished.
        this.paused.set(chat.id, { messageId: assistant.id, pause, turn })
        assistant.toolLimit = true
        assistant.note = `Paused after ${MAX_TOOL_ROUNDS} rounds of tool calls`
        assistant.status = 'done'
        return { ...assistant }
      }
      const after = await pluginHost.afterTextGeneration(before.input_text, assistant.content, model)
      assistant.content = after.response_text
      assistant.status = 'done'
    } catch (err) {
      flush()
      if (controller.signal.aborted) {
        assistant.status = 'cancelled'
        assistant.note = 'Stopped'
      } else {
        const e = err instanceof GenerationError ? err : new GenerationError((err as Error)?.message ?? String(err))
        assistant.status = 'error'
        assistant.error = e.message
        assistant.errorCode = e.code
        if (!chat.messages.includes(assistant)) {
          chat.messages.push(assistant)
          this.emit('event', { type: 'message', chatId: chat.id, message: { ...assistant } })
        }
      }
    } finally {
      if (timer) clearTimeout(timer)
      this.running.delete(chat.id)
      emitUpdate()
      chatStore.save(chat)
    }
    return { ...assistant }
  }
}

export const chatService = new ChatService()

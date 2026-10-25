import type {
  AppearanceInfo,
  Chat,
  ChatAttachment,
  ApprovalAnswer,
  ApprovalRequest,
  ContextUsage,
  ChatEvent,
  ChatSummary,
  McpDirectoryPage,
  McpDirectoryQuery,
  McpDirectoryServer,
  McpServerConfig,
  McpServerStatus,
  McpToolInfo,
  HudSnapshot,
  MemoryItem,
  ModelContextInfo,
  ModelCatalog,
  MenuAnchor,
  OverlayModelMenuPayload,
  OverlayShownPayload,
  PermissionInfo,
  PluginDialogRequest,
  PluginInfo,
  PluginInspection,
  PluginPermission,
  PluginRuntimeStatus,
  PluginSettingsView,
  Settings,
  SkillInfo,
  SlashCommand,
  UserProfile
} from './types'

/**
 * Request/response channels (ipcRenderer.invoke <-> ipcMain.handle).
 * The key is the channel name; the preload bridge exposes each one as
 * `window.llamarun.<namespace>.<method>`.
 */
export interface InvokeChannels {
  'app:version': () => string
  'app:openExternal': (url: string) => void
  'app:openSettings': (route?: string) => void
  'app:quit': () => void
  'app:appearance': () => AppearanceInfo
  'app:openChat': (chatId?: string | null) => void

  'settings:get': () => Settings
  'settings:set': (patch: Partial<Settings>) => Settings
  'settings:reset': () => Settings
  'settings:hotkeyStatus': () => { active: string | null; requested: string }

  'models:list': (options?: { force?: boolean }) => ModelCatalog

  'chats:list': () => ChatSummary[]
  'chats:get': (id: string) => Chat | null
  'chats:create': (model?: string) => Chat
  'chats:rename': (id: string, title: string) => void
  'chats:delete': (id: string) => void
  'chats:setModel': (id: string, model: string) => void
  /** Sends a user message; creates the chat when chatId is null. Returns the chat id. */
  'chats:send': (chatId: string | null, text: string, model?: string, attachments?: ChatAttachment[]) => string
  'chats:cancel': (chatId: string) => void
  /** Re-runs the last user message (after an error or to get a new answer). */
  'chats:retry': (chatId: string) => void
  /** Resumes a reply that stopped at the tool-round cap, from where it stopped. */
  'chats:continue': (chatId: string) => void
  /** Answers the model's request to run a command or script in this chat. */
  'chats:answerApproval': (id: string, answer: ApprovalAnswer) => void
  /** The open run request for a chat, if any. */
  'chats:pendingApproval': (chatId: string) => ApprovalRequest | null
  /** Summarises the older messages now (like /compact). */
  'chats:compact': (chatId: string, instructions?: string) => void
  /** How full the model's context window is for this chat (or a new one) with this model. */
  'chats:contextUsage': (chatId: string | null, model: string) => ContextUsage
  /** Context windows of these models (for the Models page). */
  'models:context': (models: string[]) => ModelContextInfo[]

  /** Reads a document the user attached (PDF, Word, text, code…) into text for the model. */
  'attachments:read': (name: string, mimeType: string, bytes: Uint8Array) => ChatAttachment

  'memory:list': () => MemoryItem[]
  'memory:add': (text: string) => MemoryItem[]
  'memory:update': (id: string, text: string) => MemoryItem[]
  'memory:remove': (id: string) => MemoryItem[]
  'memory:clear': () => MemoryItem[]

  'skills:list': () => SkillInfo[]
  /** Installs the skills found at a link (GitHub, GitLab, git, .zip, SKILL.md), a .zip file or a folder. */
  'skills:install': (source: string) => SkillInfo[]
  /** Opens a chat where the model reads the source's README and installs it, asking before each command. */
  'skills:installWithAi': (source: string) => void
  /** Picks a .zip/.skill file or a folder to install from. */
  'skills:pick': (kind: 'zip' | 'folder') => string | null
  'skills:remove': (id: string) => SkillInfo[]
  'skills:setEnabled': (id: string, enabled: boolean) => SkillInfo[]
  'skills:setTrusted': (id: string, trusted: boolean) => SkillInfo[]
  'skills:openFolder': (id?: string) => void

  /** Built-in and plugin /commands for the chat box. */
  'commands:list': () => SlashCommand[]

  'overlay:hide': () => void
  /** The overlay's content changed height; the window follows it (within its limits). */
  'overlay:resize': (height: number) => void
  /** Opens the overlay's model dropdown (its own window) under the given button. */
  'modelMenu:open': (anchor: MenuAnchor, value: string) => void
  'modelMenu:choose': (model: string) => void
  'modelMenu:close': () => void
  'modelMenu:resize': (height: number) => void
  'overlay:setChat': (chatId: string | null) => void

  'onboarding:finish': (mode: 'signin' | 'skip') => void

  'auth:signIn': () => void
  'auth:signOut': () => void
  'auth:profile': () => UserProfile

  /** Opens the website's pricing page to subscribe to Pro. */
  'account:openUpgrade': () => void
  /** Opens the website's account page (manage or cancel the subscription). */
  'account:openAccount': () => void
  /** Re-reads plan and usage from the server. */
  'account:refresh': () => UserProfile

  'mcp:list': () => McpServerConfig[]
  'mcp:status': () => McpServerStatus[]
  'mcp:tools': () => McpToolInfo[]
  'mcp:saveServer': (server: McpServerConfig) => void
  'mcp:remove': (name: string) => void
  'mcp:directory': (query: McpDirectoryQuery) => McpDirectoryPage
  'mcp:clearDirectoryCache': () => void
  'mcp:directoryServer': (id: string) => McpDirectoryServer
  'mcp:readmeUrl': (id: string) => string
  'mcp:configFromDirectory': (server: McpDirectoryServer) => McpServerConfig

  'plugins:list': () => PluginInfo[]
  'plugins:runtime': () => PluginRuntimeStatus
  'plugins:setEnabled': (id: string, enabled: boolean) => PluginInfo[]
  'plugins:reload': (id?: string) => PluginInfo[]
  'plugins:remove': (id: string) => PluginInfo[]
  /** Pick a plugin folder/.zip (or a folder to link for development) and read it without installing. */
  'plugins:inspect': (kind: PluginInspection['kind']) => PluginInspection | null
  /** Install a plugin returned by plugins:inspect with the permissions the user approved. */
  'plugins:install': (source: string, kind: PluginInspection['kind'], grants: PluginPermission[]) => PluginInfo[]
  'plugins:setGrants': (id: string, grants: PluginPermission[]) => PluginInfo[]
  'plugins:permissionCatalog': () => PermissionInfo[]
  'plugins:settings': (id: string) => PluginSettingsView
  'plugins:saveSettings': (id: string, values: Record<string, unknown>) => PluginSettingsView
  'plugins:openFolder': () => void
  'plugins:openDataFolder': (id: string) => void
  'plugins:runAction': (id: string, action: string) => void

  'hud:get': () => HudSnapshot
  'hud:click': (key: string) => void
  'hud:dismiss': (key: string) => void
  'hud:setInteractive': (interactive: boolean) => void

  'pluginDialog:get': (id: string) => PluginDialogRequest | null
  'pluginDialog:resolve': (id: string, value: unknown) => void
  'pluginDialog:resize': (id: string, height: number) => void
}

/** Main -> renderer push channels. */
export interface EventChannels {
  'chat:event': ChatEvent
  'chats:changed': ChatSummary[]
  'chat:open': string | null
  'overlay:shown': OverlayShownPayload
  'overlay:modelMenu': OverlayModelMenuPayload
  'modelMenu:show': { value: string }
  'auth:changed': UserProfile
  'settings:changed': Settings
  'mcp:changed': McpServerStatus[]
  'plugins:changed': PluginInfo[]
  /** A plugin's settings form or values changed (payload: plugin id). */
  'plugins:settingsChanged': string
  'hud:state': HudSnapshot
  'settings:navigate': string
  'memory:changed': MemoryItem[]
  'skills:changed': SkillInfo[]
  'commands:changed': SlashCommand[]
}

export type InvokeChannel = keyof InvokeChannels
export type EventChannel = keyof EventChannels

type Namespace<C extends string> = C extends `${infer N}:${string}` ? N : never
type MethodsOf<N extends string> = {
  [C in InvokeChannel as C extends `${N}:${infer M}` ? M : never]: (
    ...args: Parameters<InvokeChannels[C]>
  ) => Promise<Awaited<ReturnType<InvokeChannels[C]>>>
}

export type LlamaRunApi = {
  [N in Namespace<InvokeChannel>]: MethodsOf<N>
} & {
  on<E extends EventChannel>(channel: E, listener: (payload: EventChannels[E]) => void): () => void
  platform: string
  /** Paths of files dropped or picked in the page (Electron's webUtils). */
  files: { pathFor(file: File): string }
}

/** Runtime list of channels so the preload can build the bridge without duplicating it. */
export const INVOKE_CHANNELS = [
  'app:version',
  'app:openExternal',
  'app:openSettings',
  'app:quit',
  'app:appearance',
  'app:openChat',
  'settings:get',
  'settings:set',
  'settings:reset',
  'settings:hotkeyStatus',
  'models:list',
  'chats:list',
  'chats:get',
  'chats:create',
  'chats:rename',
  'chats:delete',
  'chats:setModel',
  'chats:send',
  'chats:cancel',
  'chats:retry',
  'chats:continue',
  'chats:compact',
  'chats:answerApproval',
  'chats:pendingApproval',
  'chats:contextUsage',
  'models:context',
  'attachments:read',
  'memory:list',
  'memory:add',
  'memory:update',
  'memory:remove',
  'memory:clear',
  'skills:list',
  'skills:install',
  'skills:installWithAi',
  'skills:pick',
  'skills:remove',
  'skills:setEnabled',
  'skills:setTrusted',
  'skills:openFolder',
  'commands:list',
  'overlay:hide',
  'overlay:resize',
  'modelMenu:open',
  'modelMenu:choose',
  'modelMenu:close',
  'modelMenu:resize',
  'overlay:setChat',
  'onboarding:finish',
  'auth:signIn',
  'auth:signOut',
  'auth:profile',
  'account:openUpgrade',
  'account:openAccount',
  'account:refresh',
  'mcp:list',
  'mcp:status',
  'mcp:tools',
  'mcp:saveServer',
  'mcp:remove',
  'mcp:directory',
  'mcp:clearDirectoryCache',
  'mcp:directoryServer',
  'mcp:readmeUrl',
  'mcp:configFromDirectory',
  'plugins:list',
  'plugins:runtime',
  'plugins:setEnabled',
  'plugins:reload',
  'plugins:remove',
  'plugins:inspect',
  'plugins:install',
  'plugins:setGrants',
  'plugins:permissionCatalog',
  'plugins:settings',
  'plugins:saveSettings',
  'plugins:openFolder',
  'plugins:openDataFolder',
  'plugins:runAction',
  'hud:get',
  'hud:click',
  'hud:dismiss',
  'hud:setInteractive',
  'pluginDialog:get',
  'pluginDialog:resolve',
  'pluginDialog:resize'
] as const satisfies readonly InvokeChannel[]

export const EVENT_CHANNELS = [
  'chat:event',
  'chats:changed',
  'chat:open',
  'overlay:shown',
  'overlay:modelMenu',
  'modelMenu:show',
  'auth:changed',
  'settings:changed',
  'mcp:changed',
  'plugins:changed',
  'plugins:settingsChanged',
  'hud:state',
  'settings:navigate',
  'memory:changed',
  'skills:changed',
  'commands:changed'
] as const satisfies readonly EventChannel[]

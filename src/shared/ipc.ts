import type {
  AppearanceInfo,
  BundleInfo,
  BundlePreview,
  ChannelStatus,
  ChatSetup,
  HookConfig,
  QueuedMessage,
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
  Routine,
  ModelContextInfo,
  ModelCatalog,
  MenuAnchor,
  OverlayModelMenuPayload,
  OverlayShownPayload,
  PermissionInfo,
  PluginAttachmentFile,
  PluginButtonContext,
  PluginDialogRequest,
  PluginInfo,
  PluginInspection,
  PluginPermission,
  PluginRuntimeStatus,
  PluginSettingsView,
  PluginSurfaces,
  PluginToolCall,
  Settings,
  SkillInfo,
  SlashCommand,
  ThinkingChoice,
  UiNode,
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
  /** How hard the model thinks in this chat; null goes back to the model's default. */
  'chats:setThinking': (id: string, thinking: ThinkingChoice | null) => void
  /** Sends a user message; creates the chat when chatId is null. Returns the chat id. */
  'chats:send': (chatId: string | null, text: string, model?: string, attachments?: ChatAttachment[], thinking?: ThinkingChoice, setup?: ChatSetup) => string
  /** The agent a chat runs as; null for none. */
  /** Plan mode on or off for a chat. */
  'chats:setPlan': (id: string, plan: boolean) => void
  /** The folder a chat works in; null for none. */
  'chats:setProject': (id: string, folder: string | null) => void
  /** Asks for a folder; its path, or null if cancelled. */
  'chats:pickFolder': () => string | null
  'chats:cancel': (chatId: string) => void
  /** Re-runs the last user message (after an error or to get a new answer). */
  'chats:retry': (chatId: string) => void
  /** Save the chat as Markdown or a self-contained HTML page; the path, or null if cancelled. */
  'chats:export': (chatId: string) => string | null
  /** A message typed while the reply runs: sent when it ends. */
  'chats:queue': (chatId: string, text: string) => void
  /** Send a queued message into the running reply now. */
  'chats:steer': (chatId: string, id: string) => void
  'chats:unqueue': (chatId: string, id: string) => void
  'chats:queued': (chatId: string) => QueuedMessage[]
  /** Edit one of the user's messages: the chat forks there and replies again; the old branch is kept. */
  'chats:edit': (chatId: string, messageId: string, text: string, undoFiles?: boolean) => void
  /** Show another version of an edited message, with its replies. */
  'chats:switchVersion': (chatId: string, messageId: string, index: number) => void
  /** Resumes a reply that stopped at the tool-round cap, from where it stopped. */
  'chats:continue': (chatId: string) => void
  /** Answers the model's request to run a command or script in this chat. */
  'chats:answerApproval': (id: string, answer: ApprovalAnswer) => void
  /** The open run request for a chat, if any. */
  'chats:pendingApproval': (chatId: string) => ApprovalRequest | null
  /** Puts back the files a reply changed with its file tools. */
  'chats:undoFiles': (chatId: string, messageId: string) => void
  /** Answers the model's question card with the option picked or the text typed. */
  'chats:answerQuestion': (id: string, text: string) => void
  /** Keeps a suggestion from the review after a task (the skill, or memory number n), or dismisses them all. */
  'chats:keepSuggestion': (chatId: string, messageId: string, what: 'skill' | number | 'dismiss') => void
  /** Summarises the older messages now (like /compact). */
  'chats:compact': (chatId: string, instructions?: string) => void
  /** How full the model's context window is for this chat (or a new one) with this model. */
  'chats:contextUsage': (chatId: string | null, model: string) => ContextUsage
  /** Context windows of these models (for the Models page). */
  'models:context': (models: string[]) => ModelContextInfo[]

  /** Reads a document the user attached (PDF, Word, text, code…) into text for the model. */
  'attachments:read': (name: string, mimeType: string, bytes: Uint8Array) => ChatAttachment

  'memory:list': () => MemoryItem[]
  /** Scheduled prompts. */
  'channels:status': () => ChannelStatus[]
  /** Connects a bot with the token the user pasted; throws if it doesn't work. */
  'channels:connect': (id: 'telegram' | 'discord', token: string) => ChannelStatus[]
  'channels:disconnect': (id: 'telegram' | 'discord') => ChannelStatus[]
  'channels:approve': (id: 'telegram' | 'discord', peer: string) => ChannelStatus[]
  'channels:block': (id: 'telegram' | 'discord', peer: string) => ChannelStatus[]
  'channels:unpair': (id: 'telegram' | 'discord', peer: string) => ChannelStatus[]
  'channels:setDeliver': (on: boolean) => ChannelStatus[]
  /** Reads a Claude Code plugin (a link or folder) and says what it would add; nothing is installed yet. */
  'bundles:inspect': (input: string) => { token: string; preview: BundlePreview }
  'bundles:install': (token: string) => BundleInfo[]
  'bundles:cancel': (token: string) => void
  'bundles:list': () => BundleInfo[]
  'bundles:remove': (name: string) => BundleInfo[]
  'hooks:get': () => HookConfig
  /** Saves the hooks (Claude Code's format); throws saying what's wrong. */
  'hooks:save': (config: HookConfig) => HookConfig
  /** Claude Code's own hooks from ~/.claude/settings.json, or null. */
  'hooks:claudeCode': () => HookConfig | null
  'routines:list': () => Routine[]
  'routines:add': (prompt: string, when: string, quiet?: boolean) => Routine[]
  'routines:setQuiet': (id: string, quiet: boolean) => Routine[]
  'routines:act': (id: string, action: 'pause' | 'resume' | 'remove' | 'run') => Routine[]
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
  /** A file picker is opening from the overlay: don't hide it when focus moves to the picker. */
  'overlay:holdOpen': () => void
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
  'mcp:signIn': (name: string) => void
  'mcp:signOut': (name: string) => void
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
  /** What running plugins added to the chat window and Settings (SDK 1.6). */
  'plugins:surfaces': () => PluginSurfaces
  /** HTML for a fenced code block a plugin draws, or null when no plugin draws its language. */
  'plugins:renderBlock': (language: string, code: string) => string | null
  /** A plugin's button was clicked; composer buttons may return text for the chat box. */
  'plugins:clickButton': (plugin: string, id: string, context: PluginButtonContext) => string | null
  'plugins:clickStatus': (plugin: string, id: string) => void
  /** HTML for a tool call's card, from the plugin that offers the tool, or null for the usual card. */
  'plugins:renderToolCard': (server: string, tool: string, call: PluginToolCall) => string | null
  /** Files from a plugin's attach-menu entry. */
  'plugins:attach': (plugin: string, id: string, chatId: string | null) => PluginAttachmentFile[]
  /** A plugin's Settings page: its current tree. */
  'plugins:page': (plugin: string, id: string) => UiNode | null
  /** A callback in a plugin's Settings page. */
  'plugins:pageEvent': (plugin: string, id: string, event: string, payload: unknown, handler?: string) => unknown

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
  'plugins:surfaces': PluginSurfaces
  'plugins:pageTree': { plugin: string; id: string; tree: UiNode }
  'hud:state': HudSnapshot
  'settings:navigate': string
  'memory:changed': MemoryItem[]
  'routines:changed': Routine[]
  'channels:changed': ChannelStatus[]
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
  'chats:setThinking',
  'chats:send',
  'chats:setPlan',
  'chats:setProject',
  'chats:pickFolder',
  'chats:cancel',
  'chats:retry',
  'chats:export',
  'chats:queue',
  'chats:steer',
  'chats:unqueue',
  'chats:queued',
  'chats:edit',
  'chats:switchVersion',
  'chats:continue',
  'chats:compact',
  'chats:answerApproval',
  'chats:pendingApproval',
  'chats:keepSuggestion',
  'chats:answerQuestion',
  'chats:undoFiles',
  'chats:contextUsage',
  'models:context',
  'attachments:read',
  'memory:list',
  'channels:status',
  'channels:connect',
  'channels:disconnect',
  'channels:approve',
  'channels:block',
  'channels:unpair',
  'channels:setDeliver',
  'bundles:inspect',
  'bundles:install',
  'bundles:cancel',
  'bundles:list',
  'bundles:remove',
  'hooks:get',
  'hooks:save',
  'hooks:claudeCode',
  'routines:list',
  'routines:add',
  'routines:setQuiet',
  'routines:act',
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
  'overlay:holdOpen',
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
  'mcp:signIn',
  'mcp:signOut',
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
  'plugins:surfaces',
  'plugins:renderBlock',
  'plugins:clickButton',
  'plugins:clickStatus',
  'plugins:renderToolCard',
  'plugins:attach',
  'plugins:page',
  'plugins:pageEvent',
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
  'plugins:surfaces',
  'plugins:pageTree',
  'hud:state',
  'settings:navigate',
  'memory:changed',
  'skills:changed',
  'commands:changed',
  'routines:changed',
  'channels:changed'
] as const satisfies readonly EventChannel[]

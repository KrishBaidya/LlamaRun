import type {
  AppearanceInfo,
  Chat,
  ChatEvent,
  ChatSummary,
  McpDirectoryPage,
  McpDirectoryQuery,
  McpDirectoryServer,
  McpServerConfig,
  McpServerStatus,
  McpToolInfo,
  HudSnapshot,
  ModelCatalog,
  OverlayShownPayload,
  PermissionInfo,
  PluginDialogRequest,
  PluginInfo,
  PluginInspection,
  PluginPermission,
  PluginRuntimeStatus,
  PluginSettingsView,
  Settings,
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

  'models:list': () => ModelCatalog

  'chats:list': () => ChatSummary[]
  'chats:get': (id: string) => Chat | null
  'chats:create': (model?: string) => Chat
  'chats:rename': (id: string, title: string) => void
  'chats:delete': (id: string) => void
  'chats:setModel': (id: string, model: string) => void
  /** Sends a user message; creates the chat when chatId is null. Returns the chat id. */
  'chats:send': (chatId: string | null, text: string, model?: string) => string
  'chats:cancel': (chatId: string) => void
  /** Re-runs the last user message (after an error or to get a new answer). */
  'chats:retry': (chatId: string) => void
  /** Resumes a reply that stopped at the tool-round cap, from where it stopped. */
  'chats:continue': (chatId: string) => void

  'overlay:hide': () => void
  'overlay:setChat': (chatId: string | null) => void

  'onboarding:finish': (mode: 'signin' | 'skip') => void

  'auth:signIn': () => void
  'auth:signOut': () => void
  'auth:profile': () => UserProfile

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
  'auth:changed': UserProfile
  'settings:changed': Settings
  'mcp:changed': McpServerStatus[]
  'plugins:changed': PluginInfo[]
  /** A plugin's settings form or values changed (payload: plugin id). */
  'plugins:settingsChanged': string
  'hud:state': HudSnapshot
  'settings:navigate': string
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
  'overlay:hide',
  'overlay:setChat',
  'onboarding:finish',
  'auth:signIn',
  'auth:signOut',
  'auth:profile',
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
  'auth:changed',
  'settings:changed',
  'mcp:changed',
  'plugins:changed',
  'plugins:settingsChanged',
  'hud:state',
  'settings:navigate'
] as const satisfies readonly EventChannel[]

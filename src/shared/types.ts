// Types shared by the main process, preload bridge and renderer windows.

export interface Settings {
  isFirstRun: boolean
  selectedModel: string
  /** Peak opacity (0-100) of the loading gradient behind the overlay. */
  appOpacity: number
  startupEnabled: boolean
  /** Electron accelerator string, e.g. "CommandOrControl+Shift+A". */
  hotkey: string
  /** Plugin folder id -> enabled. Missing entries default to enabled. */
  pluginsEnabled: Record<string, boolean>
  /** Plugin id -> permissions the user approved. Plugins without an entry wait for consent. */
  pluginGrants: Record<string, PluginPermission[]>
  /** Plugin id -> source folder, for plugins linked for development instead of copied. */
  pluginLinks: Record<string, string>
  windowWidthPct: number
  windowHeightPct: number
  /**
   * Minutes of inactivity after which the hotkey overlay starts a fresh chat
   * instead of continuing the last one. 0 = always continue.
   */
  overlayNewChatAfterMinutes: number
}

export type ChatRole = 'user' | 'assistant'
export type MessageStatus = 'streaming' | 'done' | 'error' | 'cancelled'

export interface ChatToolCall {
  name: string
  server: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  /** What is displayed. For user messages, exactly what was typed. */
  content: string
  /** User messages: the text actually sent, if a plugin rewrote it. */
  prompt?: string
  status: MessageStatus
  model?: string
  error?: string
  errorCode?: GenerationErrorCode
  /** Assistant messages: why generation was cancelled. */
  note?: string
  tools?: ChatToolCall[]
  /** User messages sent by a plugin (e.g. a voice assistant) rather than typed. */
  via?: { plugin: string; voice?: boolean }
  /** Assistant messages: stopped at the tool-round cap and can be continued. */
  toolLimit?: boolean
  createdAt: number
}

export interface Chat {
  id: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  /** Kept in memory only: never written to disk or listed (a plugin chose not to save it). */
  ephemeral?: boolean
}

export interface ChatSummary {
  id: string
  title: string
  model: string
  updatedAt: number
  messageCount: number
  preview: string
  generating: boolean
}

/** Streaming updates for one chat, broadcast to every window showing it. */
export type ChatEvent =
  | { type: 'message'; chatId: string; message: ChatMessage }
  | { type: 'delta'; chatId: string; messageId: string; text: string }
  | { type: 'tool'; chatId: string; messageId: string; tool: ChatToolCall }
  | { type: 'update'; chatId: string; message: ChatMessage }
  | { type: 'chat'; chat: Chat }

export interface AppearanceInfo {
  platform: string
  /** Windows accent colour as #rrggbb, when available. */
  accentColor: string | null
  /** The window has a Mica/Acrylic backdrop, so surfaces may be translucent. */
  material: boolean
}

export type ModelProvider = 'gemini' | 'openai' | 'ollama'

export type ModelCapability = 'tools' | 'vision' | 'thinking' | 'fast' | 'search'

/** Cloud models: which plan can use the model. */
export type ModelTier = 'free' | 'pro'
/** Cloud models: release channel. `dev` models are hidden in packaged builds. */
export type ModelStatus = 'stable' | 'preview' | 'dev'

export interface ModelInfo {
  id: string
  name: string
  provider: ModelProvider
  cloud: boolean
  /** One-line summary shown on model cards. */
  description?: string
  capabilities?: ModelCapability[]
  /** Cloud models: plan required to use the model. */
  tier?: ModelTier
  /** Cloud models: maximum context length in tokens. */
  contextWindow?: number
  /** Cloud models: release channel. */
  status?: ModelStatus
  /** Local models: size on disk in bytes. */
  size?: number
  /** Local models, e.g. "8B". */
  parameters?: string
  /** Local models, e.g. "Q4_K_M". */
  quantization?: string
  family?: string
  /** Local models: when it was downloaded or last updated (ms). */
  modifiedAt?: number
}

export interface ModelGroup {
  provider: ModelProvider
  label: string
  models: ModelInfo[]
}

export interface ModelCatalog {
  groups: ModelGroup[]
  ollamaRunning: boolean
}

export type PlanTier = 'free' | 'pro'
export type PlanStatus = 'active' | 'pending' | 'halted' | 'cancelled' | 'none'

/** The account's LlamaRun subscription (from GET /api/v1/me). */
export interface PlanInfo {
  tier: PlanTier
  status: PlanStatus
  /** ISO date the current paid period ends (renewal, or end of access when cancelled). */
  currentPeriodEnd: string | null
}

/** Cloud messages used in the current billing period. */
export interface UsageInfo {
  used: number
  limit: number
  /** ISO date the counter resets. */
  periodEnd: string
}

export interface UserProfile {
  signedIn: boolean
  name: string
  email: string
  photoURL: string
  /** Absent when signed out or when the server predates /api/v1/me. */
  plan?: PlanInfo
  usage?: UsageInfo
}

export type McpType = 'STDIO' | 'SSE'

/** Same on-disk shape as the WinUI app's mcp.json entries. */
export interface McpServerConfig {
  name: string
  mcpType: McpType
  data: {
    Command?: string | null
    Arguments?: string[]
    EnvironmentVariables?: Record<string, string>
    URL?: string | null
  }
}

export interface McpServerStatus {
  name: string
  state: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  toolCount: number
}

export interface McpToolInfo {
  name: string
  description: string
  server: string
  inputSchema: Record<string, unknown>
}

export interface McpDirectoryServer {
  id: string
  name: string
  description: string
  longDescription?: string
  submittedBy?: string
  category?: string
  author?: string
  email?: string
  verified?: boolean
  tags?: string[]
  requiresAuth?: boolean
  documentationUrl?: string
  repositoryUrl?: string
  features?: string[]
  isOpenSource?: boolean
  serverConfig?: unknown
}

export interface McpDirectoryQuery {
  search?: string
  cursor?: string | null
  /** Skip the cache and ask the directory server. */
  fresh?: boolean
}

export interface McpDirectoryPage {
  servers: McpDirectoryServer[]
  nextCursor: string | null
  /** When this page was fetched from the directory (ms). */
  cachedAt?: number
  /** Served from an old cache entry; the page may refresh it in the background. */
  stale?: boolean
}

export type PluginPermission =
  | 'hooks'
  | 'llm'
  | 'chats'
  | 'mcp'
  | 'network'
  | 'subprocess'
  | 'filesystem'
  | 'native'
  | 'microphone'
  | 'clipboard'
  | 'unrestricted'

export interface PermissionInfo {
  id: PluginPermission
  label: string
  description: string
  risk: 'low' | 'medium' | 'high'
  /** False for permissions that are declared for the user's information only. */
  enforced: boolean
}

export type PluginState = 'stopped' | 'starting' | 'running' | 'crashed' | 'error' | 'needs-consent' | 'disabled'

export interface PluginInfo {
  /** Folder name inside the Plugins directory (or the link name). */
  id: string
  name: string
  description: string
  version: string
  author: string
  sdkVersion: string
  module: string
  actions: string[]
  enabled: boolean
  loaded: boolean
  state: PluginState
  error?: string
  folder: string
  /** data: URL of icon.png if the plugin ships one. */
  icon?: string
  /** Permissions the manifest asks for (['unrestricted'] for legacy 1.0 plugins). */
  permissions: PluginPermission[]
  /** Requested permissions the user approved. */
  granted: PluginPermission[]
  legacy: boolean
  dependencies: Record<string, string>
  /** Methods other plugins can call. */
  services: string[]
  /** Event topics the plugin listens to. */
  subscriptions: string[]
  hooks: string[]
  panels: string[]
  hasSettings: boolean
  /** Runs from its source folder (Link for development). */
  linked: boolean
  /** Permissions the sandbox recently had to refuse (so the user can see why something failed). */
  blocked: PluginPermission[]
}

export interface PluginInspection {
  /** Folder or .zip the user picked. */
  source: string
  kind: 'folder' | 'zip' | 'link'
  id: string
  name: string
  version: string
  author: string
  description: string
  sdkVersion: string
  permissions: PermissionInfo[]
  /** Already installed under the same id: its version and grants, to show what's new. */
  existing?: { version: string; granted: PluginPermission[] }
  hasRequirements: boolean
}

/** One node of a plugin UI tree (see llamarun.ui). Callback props are `{ $cb: id }`. */
export interface UiNode {
  type: string
  props?: Record<string, unknown>
  children?: UiNode[]
}

export interface PluginSettingsView {
  pluginId: string
  schema: UiNode[] | null
  values: Record<string, unknown>
}

export type HudIndicator = 'none' | 'spinner' | 'pulse' | 'bars' | 'dot' | 'error'

export interface HudItem {
  key: string
  plugin: string
  title: string
  text: string
  indicator: HudIndicator
  level: number
  position: 'bottom' | 'top'
}

export interface ToastItem {
  key: string
  plugin: string
  message: string
  description?: string
  kind: 'info' | 'success' | 'warning' | 'error'
  duration: number
}

export interface HudSnapshot {
  huds: HudItem[]
  toasts: ToastItem[]
}

export interface PluginDialogRequest {
  id: string
  plugin: string
  icon?: string
  kind: 'alert' | 'confirm' | 'form'
  title: string
  message?: string
  fields?: UiNode[]
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export interface PluginViewInit {
  viewId: string
  pluginId: string
  pluginName: string
  title: string
  /** Python-built panel. */
  tree?: UiNode
  /** TSX panel: URL of the compiled bundle and its stylesheet. */
  bundle?: string
  stylesheet?: string
  state?: Record<string, unknown>
  appearance: AppearanceInfo & { dark: boolean }
  error?: string
}

export interface PluginRuntimeStatus {
  state: 'starting' | 'running' | 'stopped' | 'unavailable'
  pythonPath: string
  pythonVersion?: string
  error?: string
}

export type GenerationErrorCode =
  | 'OLLAMA_UNAVAILABLE'
  | 'NOT_AUTHENTICATED'
  | 'NO_MODEL'
  /** The model needs a paid plan (HTTP 402). */
  | 'PLAN_REQUIRED'
  /** The monthly cloud message allowance is used up (HTTP 429). */
  | 'QUOTA_EXCEEDED'
  | 'UNKNOWN'

export interface OverlayShownPayload {
  opacity: number
  /** Chat the overlay should display (null = start fresh). */
  chatId: string | null
}

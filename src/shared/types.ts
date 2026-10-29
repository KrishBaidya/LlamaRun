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
  /** The model sees saved memories and may add, change or remove them. */
  memoryEnabled: boolean
  /** Installed skills are offered to the model. */
  skillsEnabled: boolean
  /** Skill folder name -> true when turned off. Missing entries are on. */
  skillsDisabled: Record<string, boolean>
  /** Skill folder name -> its scripts run without asking. */
  skillsTrusted: Record<string, boolean>
  /** Shell commands the user chose "Always allow" for (exact text). */
  allowedCommands: string[]
  /** Summarise older messages when a chat gets close to the model's context window. */
  autoCompact: boolean
  /** Compact when the conversation fills this share (percent) of the model's window. */
  autoCompactPercent: number
  /** Most recent user turns kept word for word when compacting. */
  compactKeepTurns: number
  /** Per-model overrides, by model id. */
  modelContext: Record<string, ModelContextOverride>
  /** The model may operate apps on this PC (computer use, through Cua Driver). */
  computerUse: boolean
  /** Send window screenshots to models that can see images. */
  computerScreenshots: boolean
  /** Most tool rounds in one computer-use reply before it pauses. */
  computerMaxSteps: number
  /** Apps the user chose "Always allow" for (lower case, without .exe). */
  computerAllowedApps: string[]
  /** Apps Llama Run must never control, matched by name. */
  computerBlockedApps: string[]
}

export interface ModelContextOverride {
  /** Context window in tokens to use instead of what the model reports. */
  contextTokens?: number
  /** Compact at this percent for this model instead of the default. */
  compactAtPercent?: number
}

/** The context window a model gets, and where the number came from. */
export interface ModelContextInfo {
  model: string
  tokens: number
  source: 'override' | 'model' | 'fallback'
  /** What the model itself reports, if anything. */
  reported?: number
  compactAtPercent: number
}

export interface ContextUsage extends ModelContextInfo {
  /** Estimated tokens the next request would use. */
  used: number
  percent: number
}

/** Older messages of a chat replaced, for the model, by a summary. */
export interface ChatCompaction {
  summary: string
  /** Messages up to and including this one are covered by the summary. */
  throughMessageId: string
  createdAt: number
  tokensBefore: number
  tokensAfter: number
  /** Started by /compact or the menu, not by the threshold. */
  manual?: boolean
}

export type ChatRole = 'user' | 'assistant'
export type MessageStatus = 'streaming' | 'done' | 'error' | 'cancelled'

export interface ChatToolCall {
  name: string
  server: string
}

/** Text the model wrote, between its tool calls. */
export interface TextPart {
  type: 'text'
  text: string
}

/** One tool call in a reply: what was asked, and what came back. */
export interface ToolPart {
  type: 'tool'
  id: string
  name: string
  server: string
  /** The model's arguments (long values cut). */
  args?: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  /** The result as text, cut to a few KB for storage; images are left out. */
  result?: string
}

/** An assistant reply in the order it happened: text, tool, text, tool, ... */
export type MessagePart = TextPart | ToolPart

/** A file sent with a message. Images go to vision models; documents are read as text. */
export interface ChatAttachment {
  id: string
  kind: 'image' | 'document'
  name: string
  mimeType: string
  size: number
  /** Images: data: URL (downscaled before sending). */
  dataUrl?: string
  /** Documents: the text the model reads (may be cut short; see `truncated`). */
  text?: string
  truncated?: boolean
  /** PDFs: number of pages. */
  pages?: number
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
  /** Tools the reply used, in order. Kept with `parts` for plugins and older chats. */
  tools?: ChatToolCall[]
  /**
   * Assistant messages: the reply as it happened, text and tool calls in
   * order. `content` holds the same text joined, for copying and plugins.
   * Older chats don't have it.
   */
  parts?: MessagePart[]
  /** User messages sent by a plugin (e.g. a voice assistant) rather than typed. */
  via?: { plugin: string; voice?: boolean }
  /** Assistant messages: stopped at the tool-round cap and can be continued. */
  toolLimit?: boolean
  /** Images and documents sent with it (or posted by a plugin). */
  attachments?: ChatAttachment[]
  /** Assistant messages a plugin posted itself, not written by a model. */
  from?: { plugin: string }
  /** User messages that ran a skill as a /command: the model gets its instructions instead of the typed text. */
  skill?: { name: string; instructions: string }
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
  /** The latest summary of older messages the model sees instead of them. */
  compaction?: ChatCompaction
  /** Started by "Install with AI": the model may read web pages and run approved commands. */
  installer?: boolean
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
  /** A tool call started; `part` is its card (status "running"). */
  | { type: 'tool'; chatId: string; messageId: string; tool: ChatToolCall; part?: ToolPart }
  /** A tool call finished: the same part, with its result. */
  | { type: 'tool-done'; chatId: string; messageId: string; part: ToolPart }
  | { type: 'update'; chatId: string; message: ChatMessage }
  | { type: 'chat'; chat: Chat }
  /** Something is happening to the chat before a reply starts (compacting it). */
  | { type: 'status'; chatId: string; status: 'compacting' | null }
  /** The model is waiting for the user to allow a command or script (null: answered). */
  | { type: 'approval'; chatId: string; request: ApprovalRequest | null }

export type ApprovalAnswer = 'once' | 'always' | 'deny'

/** "May the model run this?", shown as a card in the chat, like Claude Code's permission prompt. */
export interface ApprovalRequest {
  id: string
  title: string
  /** What exactly will run, shown in monospace. */
  command: string
  /** Where it runs, and anything else worth knowing. */
  detail: string
  /** Label of the "always" button, e.g. "Always allow this skill". */
  alwaysLabel: string
}

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

/** Something the model remembers about the user, shown to it on every turn. */
export interface MemoryItem {
  id: string
  text: string
  /** Who wrote it: 'user', 'model', or a plugin's name. */
  source: string
  createdAt: number
  updatedAt: number
}

/** An installed skill: a folder with a SKILL.md the model can load and scripts it can run. */
/** shared: ~/.agents/skills (every agent); claude: ~/.claude/skills; app: Llama Run's old private folder. */
export type SkillLocation = 'shared' | 'claude' | 'app'

export interface SkillInfo {
  /** Folder name inside the Skills directory. */
  id: string
  name: string
  description: string
  enabled: boolean
  /** Its scripts run without asking first. */
  trusted: boolean
  folder: string
  location: SkillLocation
  /** Where it was installed from (a link, ZIP or folder), if known. */
  source?: string
  /** The /command that runs it from the chat box. */
  command: string
  /** Shown after the command while typing it, e.g. "[file] [format]" (argument-hint). */
  argumentHint?: string
  /** Listed in the / menu (user-invocable, default true). */
  userInvocable: boolean
  /** The model may load it on its own (not disable-model-invocation). */
  modelInvocable: boolean
  /** Python files the model may run. */
  scripts: string[]
  /** Every file in the skill, relative to its folder. */
  files: string[]
  hasRequirements: boolean
  /** pip could not install its requirements. */
  requirementsError?: string
  installedAt?: number
}

/** A /command in the chat box: built in, or added by a plugin. */
export interface SlashCommand {
  name: string
  description: string
  kind: 'builtin' | 'plugin' | 'skill'
  /** Who provides it: 'Llama Run', a plugin's name, or where a skill comes from. */
  plugin: string
  /** Text after the name, e.g. "[focus]". */
  args?: string
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
  | 'tools'
  | 'install'
  | 'network'
  | 'subprocess'
  | 'filesystem'
  | 'native'
  | 'microphone'
  | 'clipboard'
  | 'memory'
  | 'skills'
  | 'context'
  | 'appearance'
  | 'commands'
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
  /** Tools it offers your models (with the "tools" permission). */
  tools: string[]
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

/** Where to open a dropdown window: an element's rect in the opening page's coordinates. */
export interface MenuAnchor {
  x: number
  y: number
  width: number
  height: number
}

/** The overlay's model menu closed: what was chosen, if anything. */
export interface OverlayModelMenuPayload {
  chosen: string | null
}

export interface OverlayShownPayload {
  opacity: number
  /** The overlay is never shorter than this (px); short content is padded to it. */
  minHeight: number
  /** The tallest the overlay may grow (px); longer conversations scroll inside it. */
  maxHeight: number
  /** Chat the overlay should display (null = start fresh). */
  chatId: string | null
}

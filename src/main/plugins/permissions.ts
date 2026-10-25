import type { PermissionInfo, PluginPermission } from '@shared/types'

/** Everything a plugin can ask for in plugin.json "permissions". Keep in sync with llamarun/_sandbox.py. */
export const PERMISSIONS: Record<PluginPermission, PermissionInfo> = {
  hooks: {
    id: 'hooks',
    label: 'Read and change your messages',
    description: 'Sees every message you send and every reply, and can rewrite or cancel them.',
    risk: 'medium',
    enforced: true
  },
  llm: {
    id: 'llm',
    label: 'Use your AI models',
    description: 'Sends its own prompts to your local or cloud models, using your account.',
    risk: 'low',
    enforced: true
  },
  chats: {
    id: 'chats',
    label: 'Chat with your models in your chats',
    description: 'Sends messages as you, gets the replies (using your MCP tools if it also has that permission), and reads your chats.',
    risk: 'medium',
    enforced: true
  },
  mcp: {
    id: 'mcp',
    label: 'Use your MCP tools',
    description: 'Calls the tools of the MCP servers you have installed.',
    risk: 'medium',
    enforced: true
  },
  tools: {
    id: 'tools',
    label: 'Give your models new tools',
    description: 'Adds its own tools that your models can call in chats, like MCP tools. They run inside the plugin, with its other permissions.',
    risk: 'medium',
    enforced: true
  },
  install: {
    id: 'install',
    label: 'Suggest MCP servers and plugins to install',
    description: 'Browses the MCP directory and asks you to add servers or install plugins. Llama Run shows you exactly what will be added, and nothing is added unless you agree.',
    risk: 'medium',
    enforced: true
  },
  network: {
    id: 'network',
    label: 'Internet access',
    description: 'Connects to servers on the internet, for example to download models.',
    risk: 'medium',
    enforced: true
  },
  subprocess: {
    id: 'subprocess',
    label: 'Run programs',
    description: 'Starts other programs on your computer.',
    risk: 'high',
    enforced: true
  },
  filesystem: {
    id: 'filesystem',
    label: 'Your files',
    description: 'Reads and writes files anywhere you can. Without this, it only sees its own folders.',
    risk: 'high',
    enforced: true
  },
  native: {
    id: 'native',
    label: 'Native code',
    description: 'Calls system libraries directly (ctypes). Native code is not limited by the other permissions.',
    risk: 'high',
    enforced: true
  },
  microphone: {
    id: 'microphone',
    label: 'Microphone',
    description: 'Listens to your microphone.',
    risk: 'medium',
    enforced: false
  },
  clipboard: {
    id: 'clipboard',
    label: 'Clipboard',
    description: 'Reads or changes what you have copied.',
    risk: 'medium',
    enforced: false
  },
  memory: {
    id: 'memory',
    label: 'Your AI memory',
    description: 'Reads and changes what your models remember about you.',
    risk: 'medium',
    enforced: true
  },
  skills: {
    id: 'skills',
    label: 'Skills',
    description: 'Lists your installed skills and asks to install new ones.',
    risk: 'medium',
    enforced: true
  },
  context: {
    id: 'context',
    label: 'Add context to your chats',
    description: 'Adds its own instructions or live information (what you are working on, the time, your calendar) to every message your models see.',
    risk: 'medium',
    enforced: true
  },
  appearance: {
    id: 'appearance',
    label: 'Change how Llama Run looks',
    description: 'Applies its own theme (CSS) to Llama Run’s windows.',
    risk: 'low',
    enforced: true
  },
  commands: {
    id: 'commands',
    label: 'Add / commands and post in chats',
    description: 'Adds commands you can type in the chat box, like /weather, and posts its own messages (text, images, web previews) in your chats.',
    risk: 'low',
    enforced: true
  },
  unrestricted: {
    id: 'unrestricted',
    label: 'Full access (older plugin)',
    description:
      'Made for an older version of Llama Run that had no permissions, so it runs without limits: it can use your files, the internet, programs and your messages.',
    risk: 'high',
    enforced: true
  }
}

export const PERMISSION_IDS = Object.keys(PERMISSIONS) as PluginPermission[]

export function isPermission(value: unknown): value is PluginPermission {
  return typeof value === 'string' && value in PERMISSIONS
}

export function describePermissions(ids: PluginPermission[]): PermissionInfo[] {
  return ids.map((id) => PERMISSIONS[id])
}

/** Permissions the plugin actually runs with: what it asks for and the user allowed. */
export function effectiveGrants(requested: PluginPermission[], granted: PluginPermission[] | undefined): PluginPermission[] {
  if (!granted) return []
  const allowed = new Set(granted)
  return requested.filter((p) => allowed.has(p))
}

/** True when `grants` allow `permission` (unrestricted allows everything). */
export function allows(grants: Iterable<PluginPermission>, permission: PluginPermission): boolean {
  const set = new Set(grants)
  return set.has('unrestricted') || set.has(permission)
}

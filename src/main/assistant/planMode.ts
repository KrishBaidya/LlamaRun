/** Tools that only read and look things up: what helpers get in plan mode. */
export const READ_ONLY_TOOLS = [
  'read_file',
  'file_list',
  'file_glob',
  'file_grep',
  'web_fetch',
  'web_search',
  'chat_search',
  'chat_read',
  'skill_load',
  'skill_read_file',
  'todo_update',
  'wait'
]

/** What a chat in plan mode may still do: read, look up, plan out loud, ask, and hand read-only tasks to helpers. */
export const PLAN_TOOLS = new Set([...READ_ONLY_TOOLS, 'ask_user', 'agent_run'])

/** The tools a turn keeps: in plan mode only PLAN_TOOLS. Enforced on the tools offered and again on every call. */
export function allowedTools<T extends { name: string }>(tools: T[], options: { plan?: boolean }): T[] {
  return options.plan ? tools.filter((t) => PLAN_TOOLS.has(t.name)) : tools
}

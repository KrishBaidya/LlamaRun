import type { CommandRule } from '@shared/types'

/**
 * Which commands run without asking, the way OpenCode decides: rules with
 * wildcards that the user made ("Always allow `python *`"), checked against
 * every part of a command. Nothing here judges a command on its own: without
 * a matching rule, the user is asked.
 */

/** Programs whose second word picks what they do, so a rule names both ("git status *", not "git *"). */
const SUBCOMMAND_PROGRAMS = new Set(['git', 'npm', 'npx', 'pnpm', 'yarn', 'pip', 'pip3', 'uv', 'docker', 'winget', 'choco', 'scoop', 'dotnet', 'cargo', 'gh', 'kubectl', 'conda'])

/**
 * Commands that are never run without asking, whatever the rules say: they can
 * wipe a disk, the system, or a whole folder tree (Hermes keeps a list like this).
 */
const HARDLINE: { pattern: RegExp; why: string }[] = [
  { pattern: /(^|[\s;&|])(format|format\.com)\s+[a-z]:/i, why: 'formats a drive' },
  { pattern: /(^|[\s;&|])diskpart\b/i, why: 'partitions disks' },
  { pattern: /(^|[\s;&|])(shutdown|stop-computer|restart-computer)\b/i, why: 'shuts down or restarts the computer' },
  { pattern: /(^|[\s;&|])reg(\.exe)?\s+delete\s+(hklm|hkey_local_machine)/i, why: 'deletes system registry keys' },
  { pattern: /(^|[\s;&|])(bcdedit|vssadmin\s+delete|cipher\s+\/w)/i, why: 'changes boot settings or wipes data' },
  { pattern: /(^|[\s;&|])rm\s+-[a-z]*r[a-z]*\s+(\/|~|\$home)(\s|$)/i, why: 'deletes a whole drive or home folder' },
  {
    pattern: /(^|[\s;&|])(remove-item|rm|ri|del|erase|rd|rmdir)\b(?=.*(-recurse|\s-r\b|\/s\b)).*\s("|')?([a-z]:\\?|~|\$home|\$env:userprofile|%userprofile%)("|')?(\s|$)/i,
    why: 'deletes a whole drive or home folder'
  }
]

/** The parts of a command line: split at ;, &&, ||, | and newlines outside quotes. */
export function splitCommands(command: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      current += c
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      current += c
      continue
    }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      parts.push(current)
      current = ''
      i++
      continue
    }
    if (c === ';' || c === '|' || c === '\n' || c === '\r') {
      parts.push(current)
      current = ''
      continue
    }
    current += c
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** A rule's pattern against one command: whole match, * for anything, and "x *" also matches "x" alone. */
export function matchesPattern(pattern: string, command: string): boolean {
  const escaped = pattern
    .trim()
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  const re = new RegExp(`^${escaped}$`, 'is')
  if (re.test(command.trim())) return true
  return pattern.trim().endsWith(' *') && command.trim().toLowerCase() === pattern.trim().slice(0, -2).toLowerCase()
}

/** Why a command is never run without asking, if it is one of those. */
export function hardline(command: string): string | null {
  for (const { pattern, why } of HARDLINE) if (pattern.test(command)) return why
  return null
}

export type Decision = { effect: 'allow' } | { effect: 'deny'; rule: string } | { effect: 'ask'; hardline?: string }

/**
 * Allow when every part of the command matches an allow rule, deny when any
 * part matches a deny rule (deny wins), and ask otherwise, and always for the
 * hardline list.
 */
export function decide(command: string, rules: CommandRule[], extraAllowed: string[] = []): Decision {
  const parts = splitCommands(command)
  for (const part of parts) {
    const deny = rules.find((r) => r.effect === 'deny' && matchesPattern(r.pattern, part))
    if (deny) return { effect: 'deny', rule: deny.pattern }
  }
  const why = hardline(command)
  if (why) return { effect: 'ask', hardline: why }
  const allowed = [...rules.filter((r) => r.effect === 'allow').map((r) => r.pattern), ...extraAllowed]
  if (parts.length && parts.every((part) => allowed.some((p) => matchesPattern(p, part)))) return { effect: 'allow' }
  return { effect: 'ask' }
}

/** The program and, for git-like tools, its subcommand: what an "always allow" rule names. */
function prefixOf(part: string): string {
  const words = part.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  // PowerShell's call operator stays in the rule: `& "C:\Tools\x.exe" …` -> `& "C:\Tools\x.exe" *`.
  const lead = words[0] === '&' || words[0] === '.' ? `${words[0]} ` : ''
  const program = words[lead ? 1 : 0] ?? ''
  const name = program.replace(/^["']|["']$/g, '').split(/[\\/]/).pop()!.replace(/\.exe$/i, '').toLowerCase()
  const sub = words[lead ? 2 : 1]
  if (SUBCOMMAND_PROGRAMS.has(name) && sub && !sub.startsWith('-')) return `${lead}${program} ${sub}`
  return program ? `${lead}${program}` : ''
}

/** The rules "Always allow" would save for this command: one per part not already allowed, like "python *". */
export function proposeRules(command: string, rules: CommandRule[] = []): string[] {
  const allowed = rules.filter((r) => r.effect === 'allow').map((r) => r.pattern)
  const out: string[] = []
  for (const part of splitCommands(command)) {
    if (allowed.some((p) => matchesPattern(p, part))) continue
    const prefix = prefixOf(part)
    if (!prefix) continue
    const rule = `${prefix} *`
    if (!out.includes(rule)) out.push(rule)
  }
  return out
}

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Blocks, Sparkles, SquareSlash } from 'lucide-react'
import type { SlashCommand } from '@shared/types'
import { api } from '@/hooks/use-llamarun'
import { cn } from '@/lib/utils'

/** Built-in commands, plugin commands and skills, kept current as plugins start and skills change. */
export function useSlashCommands(): SlashCommand[] {
  const [commands, setCommands] = useState<SlashCommand[]>([])
  useEffect(() => {
    void api.commands.list().then(setCommands)
    return api.on('commands:changed', setCommands)
  }, [])
  return commands
}

/**
 * Commands matching what follows the "/", best first, as Claude Code ranks
 * them: names that start with it, then names that contain it (so "pdf" finds
 * "fill-pdf"), then ones whose description mentions it.
 */
export function rankCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase()
  if (!q) return commands
  const score = (c: SlashCommand): number => {
    const name = c.name.toLowerCase()
    if (name.startsWith(q)) return 0
    if (name.split(/[-_:.]/).some((part) => part.startsWith(q))) return 1
    if (name.includes(q)) return 2
    if (c.description.toLowerCase().includes(q)) return 3
    return -1
  }
  return commands
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.c.name.length - b.c.name.length)
    .map((x) => x.c)
}

export interface SlashMenuState {
  open: boolean
  matches: SlashCommand[]
  active: number
  /** Handles ↑ ↓ Tab Enter Esc while the menu is open; true when it used the key. */
  onKeyDown: (e: KeyboardEvent) => boolean
  pick: (c: SlashCommand) => void
}

/**
 * Suggestions while the prompt is a bare "/word". Picking one fills in
 * "/name " when it takes arguments (its hint shows what), or runs it.
 */
export function useSlashMenu(text: string, setText: (t: string) => void, onRun: (command: string) => void): SlashMenuState {
  const commands = useSlashCommands()
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const m = /^\/([\w:.-]*)$/.exec(text)
  const matches = m ? rankCommands(commands, m[1]) : []
  const open = matches.length > 0 && dismissed !== text
  useEffect(() => setActive(0), [text])

  const pick = (c: SlashCommand): void => {
    if (c.args) setText(`/${c.name} `)
    else {
      setText('')
      onRun(`/${c.name}`)
    }
  }

  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (!open) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
      return true
    }
    if (e.key === 'Tab') {
      // Tab completes the name without running it, so arguments can follow.
      e.preventDefault()
      setText(`/${(matches[active] ?? matches[0]).name} `)
      return true
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      pick(matches[active] ?? matches[0])
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setDismissed(text)
      return true
    }
    return false
  }

  return { open, matches, active, onKeyDown, pick }
}

const KIND_ICON = { builtin: SquareSlash, plugin: Blocks, skill: Sparkles }

export function SlashMenu({ menu, className }: { menu: SlashMenuState; className?: string }) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' })
  }, [menu.active])
  if (!menu.open) return null
  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Commands and skills"
      className={cn('flex max-h-72 flex-col gap-px overflow-y-auto rounded-xl border bg-popover p-1 text-sm shadow-lg', className)}
    >
      {menu.matches.map((c, i) => {
        const Icon = KIND_ICON[c.kind] ?? SquareSlash
        return (
          <button
            key={`${c.kind}:${c.name}`}
            role="option"
            aria-selected={i === menu.active}
            onMouseDown={(e) => {
              e.preventDefault()
              menu.pick(c)
            }}
            className={cn('flex shrink-0 items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left', i === menu.active && 'bg-accent')}
          >
            <Icon className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
            <span className="shrink-0 font-medium">/{c.name}</span>
            {c.args && <span className="shrink-0 text-xs text-muted-foreground">{c.args}</span>}
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={c.description}>
              {c.description}
            </span>
            <span className="shrink-0 text-2xs text-muted-foreground">{c.plugin}</span>
          </button>
        )
      })}
    </div>
  )
}

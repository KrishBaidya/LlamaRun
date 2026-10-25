import { useEffect, useState, type KeyboardEvent } from 'react'
import type { SlashCommand } from '@shared/types'
import { api } from '@/hooks/use-llamarun'
import { cn } from '@/lib/utils'

/** Built-in and plugin /commands, kept current as plugins start and stop. */
export function useSlashCommands(): SlashCommand[] {
  const [commands, setCommands] = useState<SlashCommand[]>([])
  useEffect(() => {
    void api.commands.list().then(setCommands)
    return api.on('commands:changed', setCommands)
  }, [])
  return commands
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
 * "/name " (or runs it, for commands without arguments, via `onRun`).
 */
export function useSlashMenu(text: string, setText: (t: string) => void, onRun: (command: string) => void): SlashMenuState {
  const commands = useSlashCommands()
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const m = /^\/([\w-]*)$/.exec(text)
  const matches = m ? commands.filter((c) => c.name.startsWith(m[1].toLowerCase())) : []
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
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
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

export function SlashMenu({ menu, className }: { menu: SlashMenuState; className?: string }) {
  if (!menu.open) return null
  return (
    <div role="listbox" aria-label="Commands" className={cn('flex flex-col gap-px rounded-xl border bg-popover p-1 text-sm shadow-lg', className)}>
      {menu.matches.map((c, i) => (
        <button
          key={c.name}
          role="option"
          aria-selected={i === menu.active}
          onMouseDown={(e) => {
            e.preventDefault()
            menu.pick(c)
          }}
          className={cn('flex items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left', i === menu.active && 'bg-accent')}
        >
          <span className="font-medium">/{c.name}</span>
          {c.args && <span className="text-xs text-muted-foreground">{c.args}</span>}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{c.description}</span>
          <span className="shrink-0 text-2xs text-muted-foreground">{c.plugin}</span>
        </button>
      ))}
    </div>
  )
}

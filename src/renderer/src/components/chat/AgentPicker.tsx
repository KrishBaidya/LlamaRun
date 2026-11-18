import { useEffect, useState } from 'react'
import { Bot, Check, ChevronDown, ClipboardList } from 'lucide-react'
import type { AgentInfo } from '@shared/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '@/hooks/use-llamarun'
import { cn } from '@/lib/utils'

/** The user's custom agents (Llama Run's, Claude Code's and OpenCode's), refreshed when the menu opens. */
function useAgents(): [AgentInfo[], () => void] {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const load = (): void => void api.agents.list().then(setAgents)
  useEffect(load, [])
  return [agents, load]
}

const SOURCE: Record<AgentInfo['location'], string> = { llamarun: '', claude: 'Claude Code', opencode: 'OpenCode' }

/** Which agent this chat runs as: its prompt, and only its tools. Hidden until there are agents. */
export function AgentPicker({ value, onChange, disabled }: { value: string | undefined; onChange: (agent: string | undefined) => void; disabled?: boolean }) {
  const [agents, reload] = useAgents()
  const current = value ? agents.find((a) => a.id === value) : undefined
  if (!agents.length && !value) return null
  return (
    <DropdownMenu onOpenChange={(open) => open && reload()}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button variant="ghost" size="sm" title="Run this chat as one of your agents" className="gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground">
          <Bot className="size-3.5" />
          <span className="max-w-32 truncate">{current?.name ?? (value ? 'Missing agent' : 'Agent')}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-80 min-w-52">
        <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">Agent for this chat</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(undefined)}>
          <Check className={cn('size-3.5', value && 'invisible')} />
          None
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {agents.map((a) => (
          <DropdownMenuItem key={a.id} onSelect={() => onChange(a.id)} className="items-start">
            <Check className={cn('mt-0.5 size-3.5', value !== a.id && 'invisible')} />
            <span className="min-w-0">
              <span className="block truncate">
                {a.name}
                {SOURCE[a.location] && <span className="ms-1.5 text-2xs text-muted-foreground">{SOURCE[a.location]}</span>}
              </span>
              {a.description && <span className="line-clamp-2 text-2xs text-muted-foreground">{a.description}</span>}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void api.app.openSettings('/agents')}>Manage agents…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Plan mode: the model only reads and looks things up until it's turned off. */
export function PlanToggle({ value, onChange, disabled }: { value: boolean; onChange: (plan: boolean) => void; disabled?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      aria-pressed={value}
      title={value ? 'Plan mode is on: the model only reads and looks things up. Click to let it act.' : 'Plan mode: the model only reads and looks things up, and plans before acting'}
      className={cn('gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground', value && 'bg-accent text-foreground')}
      onClick={() => onChange(!value)}
    >
      <ClipboardList className="size-3.5" />
      <span>Plan</span>
    </Button>
  )
}

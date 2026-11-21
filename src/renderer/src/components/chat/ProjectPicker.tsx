import { Check, ChevronDown, Folder, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '@/hooks/use-llamarun'
import { cn } from '@/lib/utils'

export const folderName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

/**
 * The folder this chat works in: commands and relative paths start there, the
 * file tools may use it without asking, and its AGENTS.md / CLAUDE.md joins the prompt.
 */
export function ProjectPicker({ value, recent, onChange, disabled }: { value: string | undefined; recent: string[]; onChange: (folder: string | undefined) => void; disabled?: boolean }) {
  const choose = (): void => void api.chats.pickFolder().then((folder) => folder && onChange(folder))
  const others = recent.filter((f) => f !== value).slice(0, 6)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="ghost"
          size="sm"
          title={value ? `Works in ${value}` : 'Choose a folder for this chat to work in'}
          className={cn('gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground', value && 'text-foreground')}
        >
          <Folder className="size-3.5" />
          <span className="max-w-32 truncate">{value ? folderName(value) : 'Folder'}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-80 min-w-52">
        <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">Folder this chat works in</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(undefined)}>
          <Check className={cn('size-3.5', value && 'invisible')} />
          None (the skills workspace)
        </DropdownMenuItem>
        {value && (
          <DropdownMenuItem onSelect={() => undefined}>
            <Check className="size-3.5" />
            <span className="truncate">{value}</span>
          </DropdownMenuItem>
        )}
        {others.length > 0 && <DropdownMenuSeparator />}
        {others.map((f) => (
          <DropdownMenuItem key={f} onSelect={() => onChange(f)}>
            <Check className="invisible size-3.5" />
            <span className="truncate" title={f}>
              {folderName(f)} <span className="text-2xs text-muted-foreground">{f}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={choose}>
          <FolderOpen className="size-3.5" />
          Choose a folder…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

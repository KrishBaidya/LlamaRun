import { useMemo, useState } from 'react'
import { LoaderCircle, MoreHorizontal, Pencil, Search, Settings2, SquarePen, Trash2 } from 'lucide-react'
import type { ChatSummary } from '@shared/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { api } from '@/hooks/use-llamarun'
import { cn, relativeDay } from '@/lib/utils'
import { TitleBar } from '@/components/TitleBar'

function ChatRow({
  chat,
  active,
  onSelect,
  onDelete
}: {
  chat: ChatSummary
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(chat.title)

  if (editing) {
    return (
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          setEditing(false)
          if (title.trim() && title !== chat.title) void api.chats.rename(chat.id, title)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setTitle(chat.title)
            setEditing(false)
          }
        }}
        className="h-8 w-full rounded-control border border-ring/50 bg-card px-2.5 text-sm outline-none"
      />
    )
  }

  return (
    <div
      className={cn(
        'group/row relative flex h-8 items-center rounded-control text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-row-hover',
        active && 'bg-sidebar-row-selected font-medium shadow-xs'
      )}
    >
      <button onClick={onSelect} onDoubleClick={() => setEditing(true)} className="flex h-full min-w-0 flex-1 items-center gap-2 px-2.5 text-left">
        <span className="truncate">{chat.title}</span>
        {chat.generating && <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="me-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-accent data-[state=open]:opacity-100"
            aria-label="Chat actions"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function ChatSidebar({
  chats,
  activeId,
  onSelect,
  onNew
}: {
  chats: ChatSummary[] | null
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}) {
  const [query, setQuery] = useState('')
  const [toDelete, setToDelete] = useState<ChatSummary | null>(null)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = (chats ?? []).filter(
      (c) => !q || c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)
    )
    const out: { label: string; chats: ChatSummary[] }[] = []
    for (const c of filtered) {
      const label = relativeDay(c.updatedAt)
      const group = out.find((g) => g.label === label)
      if (group) group.chats.push(c)
      else out.push({ label, chats: [c] })
    }
    return out
  }, [chats, query])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <TitleBar className="pe-3">
        <span className="text-sm font-semibold tracking-tight">Llama Run</span>
      </TitleBar>
      <div className="flex flex-col gap-2 px-2 pb-2">
        <Button variant="outline" className="w-full justify-start" onClick={onNew}>
          <SquarePen /> New chat
          <span className="ms-auto text-2xs text-muted-foreground">Ctrl+N</span>
        </Button>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="h-8 w-full rounded-control bg-sidebar-row-hover ps-8 pe-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <div className="px-2.5 pt-1 pb-1 text-2xs font-medium text-sidebar-muted-foreground">{g.label}</div>
            <div className="flex flex-col gap-px">
              {g.chats.map((c) => (
                <ChatRow
                  key={c.id}
                  chat={c}
                  active={c.id === activeId}
                  onSelect={() => onSelect(c.id)}
                  onDelete={() => setToDelete(c)}
                />
              ))}
            </div>
          </div>
        ))}
        {chats && groups.length === 0 && (
          <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
            {query ? 'No matching chats' : 'Your chats will appear here.'}
          </p>
        )}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={() => void api.app.openSettings('/')}>
          <Settings2 /> Settings
        </Button>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>"{toDelete?.title}" will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const c = toDelete!
                setToDelete(null)
                void api.chats.delete(c.id)
                if (c.id === activeId) onNew()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}

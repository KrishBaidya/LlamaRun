import { useEffect, useState } from 'react'
import { Bot, Brain, Check, Pencil, Plus, Trash2, User, X } from 'lucide-react'
import { toast } from 'sonner'
import type { MemoryItem } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api, useSettings } from '@/hooks/use-llamarun'
import { errorMessage, relativeTime } from '@/lib/utils'
import { EmptyState, Page, PageHeader, SettingRow } from '../components'

function SourceBadge({ source }: { source: string }) {
  const icon = source === 'user' ? <User className="size-3" /> : source === 'model' ? <Bot className="size-3" /> : null
  const label = source === 'user' ? 'You' : source === 'model' ? 'AI' : source
  return (
    <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-2xs font-normal">
      {icon}
      {label}
    </Badge>
  )
}

function MemoryRow({ item }: { item: MemoryItem }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const save = (): void => {
    void api.memory
      .update(item.id, text)
      .then(() => setEditing(false))
      .catch((err) => toast.error(errorMessage(err)))
  }
  return (
    <div className="group flex items-start gap-3 py-2.5">
      {editing ? (
        <Input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="h-8 flex-1"
        />
      ) : (
        <p className="min-w-0 flex-1 pt-1 text-sm" data-selectable>
          {item.text}
        </p>
      )}
      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        <SourceBadge source={item.source} />
        <span className="text-2xs text-muted-foreground" title={new Date(item.updatedAt).toLocaleString()}>
          {relativeTime(item.updatedAt)}
        </span>
        {editing ? (
          <>
            <Button size="icon-sm" variant="ghost" title="Save" onClick={save}>
              <Check />
            </Button>
            <Button size="icon-sm" variant="ghost" title="Cancel" onClick={() => setEditing(false)}>
              <X />
            </Button>
          </>
        ) : (
          <>
            <Button size="icon-sm" variant="ghost" title="Edit" onClick={() => (setText(item.text), setEditing(true))}>
              <Pencil />
            </Button>
            <Button size="icon-sm" variant="ghost" title="Forget" onClick={() => void api.memory.remove(item.id)}>
              <Trash2 />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/** What the AI remembers about you: shown to it on every message, and it can add, fix or forget things. */
export function MemoryPage() {
  const [settings, update] = useSettings()
  const [items, setItems] = useState<MemoryItem[] | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void api.memory.list().then(setItems)
    return api.on('memory:changed', setItems)
  }, [])

  const add = (): void => {
    if (!draft.trim()) return
    void api.memory
      .add(draft)
      .then(() => setDraft(''))
      .catch((err) => toast.error(errorMessage(err)))
  }

  const on = settings?.memoryEnabled !== false
  return (
    <Page>
      <PageHeader
        title="Memory"
        description="What your AI knows about you. It sees these on every message, and saves, corrects or forgets them as you chat."
        actions={
          items?.length ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (window.confirm('Forget everything the AI remembers about you?')) void api.memory.clear()
              }}
            >
              <Trash2 /> Clear all
            </Button>
          ) : null
        }
      />
      <Card>
        <CardContent className="divide-y py-0">
          <SettingRow title="Use memory" description="Turn off to stop the AI reading or changing memories. Nothing is deleted.">
            <Switch checked={on} onCheckedChange={(v) => void update({ memoryEnabled: v })} />
          </SettingRow>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="size-4" /> Remembered
            {items && <span className="text-xs font-normal text-muted-foreground">{items.length}</span>}
          </CardTitle>
          <CardDescription>Try telling it “remember that I prefer short answers”, or add something yourself.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              value={draft}
              placeholder="e.g. I'm a product manager at a fintech startup"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <Button onClick={add} disabled={!draft.trim()}>
              <Plus /> Add
            </Button>
          </div>
          {items && !items.length ? (
            <EmptyState icon={<Brain />} title="Nothing yet">
              As you chat, the AI saves lasting facts about you here: your name, work, preferences and projects.
            </EmptyState>
          ) : (
            <div className="divide-y">{items?.map((m) => <MemoryRow key={m.id} item={m} />)}</div>
          )}
        </CardContent>
      </Card>
    </Page>
  )
}

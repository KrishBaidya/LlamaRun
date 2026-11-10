import { useEffect, useState } from 'react'
import { AlarmClock, MessagesSquare, Pause, Play, Plus, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import type { Routine } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/hooks/use-llamarun'
import { errorMessage, relativeTime } from '@/lib/utils'
import { EmptyState, Page, PageHeader } from '../components'

const at = (t: number): string => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function RoutineRow({ routine }: { routine: Routine }) {
  const act = (action: 'pause' | 'resume' | 'remove' | 'run'): void => void api.routines.act(routine.id, action).catch((err) => toast.error(errorMessage(err)))
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{routine.prompt}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {routine.when} · {routine.paused ? 'paused' : routine.next ? `next ${at(routine.next)}` : 'done'}
          {routine.lastRun ? ` · last ran ${relativeTime(routine.lastRun)}` : ''}
        </p>
      </div>
      {routine.lastStatus && routine.lastStatus !== 'done' && <Badge variant="destructive">{routine.lastStatus === 'error' ? 'Failed' : 'Stopped'}</Badge>}
      <div className="flex shrink-0 items-center gap-0.5">
        {routine.chatId && (
          <Button size="icon-sm" variant="ghost" title="Open its chat" onClick={() => void api.app.openChat(routine.chatId)}>
            <MessagesSquare />
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" title="Run now" onClick={() => act('run')}>
          <Zap />
        </Button>
        {routine.paused ? (
          <Button size="icon-sm" variant="ghost" title="Resume" onClick={() => act('resume')}>
            <Play />
          </Button>
        ) : (
          <Button size="icon-sm" variant="ghost" title="Pause" onClick={() => act('pause')}>
            <Pause />
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" title="Remove" onClick={() => act('remove')}>
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}

/** Prompts Llama Run runs by itself on a schedule, each in its own chat. */
export function RoutinesPage() {
  const [routines, setRoutines] = useState<Routine[] | null>(null)
  const [prompt, setPrompt] = useState('')
  const [when, setWhen] = useState('')

  useEffect(() => {
    void api.routines.list().then(setRoutines)
    return api.on('routines:changed', setRoutines)
  }, [])

  const add = (): void => {
    if (!prompt.trim() || !when.trim()) return
    void api.routines
      .add(prompt, when)
      .then(() => (setPrompt(''), setWhen('')))
      .catch((err) => toast.error(errorMessage(err)))
  }

  return (
    <Page>
      <PageHeader
        title="Routines"
        description="Prompts Llama Run runs by itself on a schedule while it's open in the tray, each in its own chat, ending with a notification. Or ask in a chat: “every weekday at 9, summarise my Downloads folder”."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlarmClock className="size-4" /> Scheduled
          </CardTitle>
          <CardDescription>
            Nobody is there to approve during a run, so only commands you allowed with a rule (Settings › Skills) run, and computer use is off.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {routines && !routines.length ? (
            <EmptyState icon={<AlarmClock />} title="No routines yet">
              Add one below, or ask in a chat.
            </EmptyState>
          ) : (
            <div className="divide-y">{routines?.map((r) => <RoutineRow key={r.id} routine={r} />)}</div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input className="flex-[2]" placeholder="What to do, e.g. Summarise today's news about AI" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <Input
              className="flex-1"
              placeholder="daily 9:00, every 2h, weekdays at 9am…"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <Button variant="outline" onClick={add} disabled={!prompt.trim() || !when.trim()}>
              <Plus /> Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </Page>
  )
}

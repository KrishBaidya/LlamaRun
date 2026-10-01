// A panel written in TSX. It renders with Llama Run's own components and
// Tailwind classes; Python owns the data (usePluginState) and handles the
// events (emit / call → panel.on(...) in ui_showcase.py).
import { useState } from 'react'
import { Button, Card, CardContent, Icon, Input, Markdown } from '@llamarun/ui'
import { call, emit, usePluginState } from '@llamarun/plugin'
import { formatTime } from './format'

interface Note {
  text: string
  at: number
}

export default function Notes() {
  const { notes = [] } = usePluginState<{ notes: Note[] }>()
  const [draft, setDraft] = useState('')
  const [summary, setSummary] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const add = () => {
    if (!draft.trim()) return
    emit('add', draft)
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-3 p-4 pt-1">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a note…" autoFocus />
        <Button type="submit" disabled={!draft.trim()}>
          <Icon name="plus" /> Add
        </Button>
      </form>

      {notes.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note, i) => (
            <li key={`${note.at}-${i}`}>
              <Card className="flex-row items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{note.text}</div>
                  <div className="text-2xs text-muted-foreground">{formatTime(note.at)}</div>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => emit('remove', i)}>
                  <Icon name="trash-2" />
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="outline"
        className="w-fit"
        disabled={busy || notes.length === 0}
        onClick={async () => {
          setBusy(true)
          try {
            setSummary(await call<string>('summarize'))
          } catch (err) {
            setSummary(`Couldn't summarize: ${(err as Error).message}`)
          } finally {
            setBusy(false)
          }
        }}
      >
        <Icon name="sparkles" /> {busy ? 'Summarizing…' : 'Summarize with the model'}
      </Button>
      {summary && (
        <Card>
          <CardContent>
            <Markdown text={summary} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

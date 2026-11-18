import { CornerDownRight, X } from 'lucide-react'
import type { QueuedMessage } from '@shared/types'
import { Button } from '@/components/ui/button'

/** Follow-ups typed while the reply runs: each waits for it to end, or goes into it now with Send now. */
export function QueuedMessages({ items, busy, onSteer, onRemove }: { items: QueuedMessage[]; busy: boolean; onSteer: (id: string) => void; onRemove: (id: string) => void }) {
  if (!items.length) return null
  return (
    <div className="flex flex-col gap-1 px-3 pt-3">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2 rounded-xl bg-muted/60 px-2.5 py-1.5 text-xs">
          <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{item.text}</span>
          {item.steer ? (
            <span className="shrink-0 text-2xs text-muted-foreground">Goes in at the next step</span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-2 text-2xs"
              title={busy ? 'Give it to the model at its next step instead of waiting for the reply to finish' : 'Send it now'}
              onClick={() => onSteer(item.id)}
            >
              Send now
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" className="size-6 shrink-0" title="Remove" onClick={() => onRemove(item.id)}>
            <X className="size-3" />
          </Button>
        </div>
      ))}
    </div>
  )
}

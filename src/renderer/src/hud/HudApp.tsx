import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from 'lucide-react'
import type { HudItem, HudSnapshot, ToastItem } from '@shared/types'
import { api } from '@/hooks/use-llamarun'
import { cn } from '@/lib/utils'

/** Keeps removed items around briefly so they can fade out. */
function usePresence<T extends { key: string }>(items: T[]): (T & { leaving: boolean })[] {
  const [shown, setShown] = useState<(T & { leaving: boolean })[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    setShown((prev) => {
      const next = items.map((i) => ({ ...i, leaving: false }))
      const keys = new Set(items.map((i) => i.key))
      for (const [index, old] of prev.entries()) {
        if (keys.has(old.key)) continue
        next.splice(Math.min(index, next.length), 0, { ...old, leaving: true })
        if (!timers.current.has(old.key)) {
          timers.current.set(
            old.key,
            setTimeout(() => {
              timers.current.delete(old.key)
              setShown((s) => s.filter((x) => !(x.key === old.key && x.leaving)))
            }, 220)
          )
        }
      }
      return next
    })
  }, [items])
  return shown
}

function Indicator({ hud }: { hud: HudItem }) {
  switch (hud.indicator) {
    case 'spinner':
      return <span className="block size-6 animate-spin rounded-full border-[2.5px] border-primary/25 border-t-primary" />
    case 'pulse': {
      const ring = 14 + hud.level * 16
      return (
        <span className="relative flex size-8 items-center justify-center">
          <span
            className="absolute rounded-full border-2 border-primary/70 transition-all duration-75 ease-out"
            style={{ width: ring, height: ring }}
          />
          <span className="size-3 animate-pulse rounded-full bg-primary" />
        </span>
      )
    }
    case 'bars':
      return (
        <span className="flex h-6 items-center gap-[3px]">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="w-[4px] rounded-full bg-primary"
              style={{ height: '100%', animation: `hud-bar 0.9s ease-in-out ${i * 0.13}s infinite` }}
            />
          ))}
        </span>
      )
    case 'dot':
      return <span className="size-3 rounded-full bg-emerald-500" />
    case 'error':
      return <AlertTriangle className="size-5 text-destructive" />
    default:
      return null
  }
}

function Surface({
  children,
  leaving,
  onClick,
  className
}: {
  children: React.ReactNode
  leaving: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <div
      role="button"
      tabIndex={-1}
      onPointerEnter={() => void api.hud.setInteractive(true)}
      onPointerLeave={() => void api.hud.setInteractive(false)}
      onClick={onClick}
      className={cn(
        'pointer-events-auto w-full cursor-default rounded-2xl border border-border/70 bg-popover/95 text-popover-foreground shadow-xl shadow-black/15 backdrop-blur-xl',
        'animate-in fade-in-0 slide-in-from-bottom-2 duration-200',
        leaving && 'animate-out fade-out-0 slide-out-to-bottom-2 fill-mode-forwards',
        className
      )}
    >
      {children}
    </div>
  )
}

function HudCard({ hud }: { hud: HudItem & { leaving: boolean } }) {
  const hasIndicator = hud.indicator !== 'none'
  return (
    <Surface leaving={hud.leaving} onClick={() => void api.hud.click(hud.key)} className="flex items-start gap-3 px-4 py-3">
      {hasIndicator && (
        <span className="flex size-8 shrink-0 items-center justify-center">
          <Indicator hud={hud} />
        </span>
      )}
      <div className={cn('flex min-w-0 flex-1 flex-col', hasIndicator && 'pt-1')}>
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{hud.title || hud.plugin}</span>
          {hud.title && <span className="ms-auto shrink-0 text-2xs text-muted-foreground">{hud.plugin}</span>}
        </div>
        {hud.text && <p className="mt-0.5 line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">{hud.text}</p>}
      </div>
    </Surface>
  )
}

const TOAST_ICON = { info: Info, success: CheckCircle2, warning: CircleAlert, error: AlertTriangle }
const TOAST_TONE = {
  info: 'text-primary',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  error: 'text-destructive'
}

function ToastCard({ toast }: { toast: ToastItem & { leaving: boolean } }) {
  const IconFor = TOAST_ICON[toast.kind]
  return (
    <Surface leaving={toast.leaving} onClick={() => void api.hud.dismiss(toast.key)} className="flex items-start gap-3 px-4 py-2.5">
      <IconFor className={cn('mt-0.5 size-4 shrink-0', TOAST_TONE[toast.kind])} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{toast.message}</span>
          <span className="ms-auto shrink-0 text-2xs text-muted-foreground">{toast.plugin}</span>
        </div>
        {toast.description && <p className="mt-0.5 line-clamp-6 text-xs whitespace-pre-wrap text-muted-foreground">{toast.description}</p>}
      </div>
    </Surface>
  )
}

export function HudApp() {
  const [snapshot, setSnapshot] = useState<HudSnapshot>({ huds: [], toasts: [] })
  useEffect(() => {
    void api.hud.get().then(setSnapshot)
    return api.on('hud:state', setSnapshot)
  }, [])
  const huds = usePresence(snapshot.huds)
  const toasts = usePresence(snapshot.toasts)
  const top = huds.length > 0 && huds.every((h) => h.position === 'top')

  return (
    <div className={cn('pointer-events-none flex h-screen flex-col gap-2 p-3', top ? 'justify-start' : 'justify-end')}>
      {top ? (
        <>
          {huds.map((h) => (
            <HudCard key={h.key} hud={h} />
          ))}
          {toasts.map((t) => (
            <ToastCard key={t.key} toast={t} />
          ))}
        </>
      ) : (
        <>
          {toasts.map((t) => (
            <ToastCard key={t.key} toast={t} />
          ))}
          {huds.map((h) => (
            <HudCard key={h.key} hud={h} />
          ))}
        </>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import type { PermissionInfo, PluginPermission } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface ConsentRequest {
  title: string
  name: string
  author: string
  version: string
  description?: string
  permissions: PermissionInfo[]
  /** Already approved earlier (an update); new ones are highlighted. */
  previouslyGranted?: PluginPermission[]
  note?: string
  confirmLabel: string
}

const RISK_TONE = {
  low: 'secondary',
  medium: 'outline',
  high: 'destructive'
} as const

/** Shows what a plugin asks for and lets the user untick optional permissions. */
export function PermissionConsentDialog({
  request,
  busy,
  onCancel,
  onConfirm
}: {
  request: ConsentRequest | null
  busy?: boolean
  onCancel: () => void
  onConfirm: (grants: PluginPermission[]) => void
}) {
  const [checked, setChecked] = useState<Set<PluginPermission>>(new Set())
  useEffect(() => {
    if (request) setChecked(new Set(request.permissions.map((p) => p.id)))
  }, [request])

  const legacy = request?.permissions.some((p) => p.id === 'unrestricted')
  const previously = new Set(request?.previouslyGranted ?? [])

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="max-w-md">
        {request && (
          <>
            <DialogHeader>
              <DialogTitle>{request.title}</DialogTitle>
              <DialogDescription>
                {request.name} {request.version} by {request.author || 'an unknown author'}
              </DialogDescription>
            </DialogHeader>

            {request.permissions.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border px-3 py-3 text-sm">
                <ShieldCheck className="size-4 text-emerald-500" />
                This plugin doesn't need any permissions. It can only use its own data folder.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground">
                  {legacy ? 'This plugin can:' : 'This plugin asks to:'}
                </p>
                <ul className="flex flex-col divide-y rounded-lg border">
                  {request.permissions.map((p) => (
                    <li key={p.id} className="flex items-start gap-3 px-3 py-2.5">
                      {legacy ? (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                      ) : (
                        <Checkbox
                          className="mt-0.5"
                          checked={checked.has(p.id)}
                          onCheckedChange={(v) =>
                            setChecked((s) => {
                              const next = new Set(s)
                              if (v === true) next.add(p.id)
                              else next.delete(p.id)
                              return next
                            })
                          }
                          aria-label={p.label}
                        />
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {p.label}
                          {p.risk !== 'low' && <Badge variant={RISK_TONE[p.risk]}>{p.risk} risk</Badge>}
                          {request.previouslyGranted && !previously.has(p.id) && <Badge variant="default">new</Badge>}
                        </div>
                        <p className={cn('text-xs text-muted-foreground')}>
                          {p.description}
                          {!p.enforced && ' Llama Run shows this so you know, but it cannot limit it.'}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                {!legacy && (
                  <p className="pt-1 text-2xs text-muted-foreground">
                    Untick anything you don't want to allow. The plugin may not work fully without it. You can change this later.
                  </p>
                )}
              </div>
            )}
            {request.note && <p className="text-xs text-muted-foreground">{request.note}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant={legacy ? 'destructive' : 'default'}
                disabled={busy}
                onClick={() => onConfirm(request.permissions.map((p) => p.id).filter((id) => legacy || checked.has(id)))}
              >
                {request.confirmLabel}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

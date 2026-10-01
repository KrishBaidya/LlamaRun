import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Blocks } from 'lucide-react'
import type { PluginDialogRequest } from '@shared/types'
import { TitleBar } from '@/components/TitleBar'
import { Button } from '@/components/ui/button'
import { api } from '@/hooks/use-llamarun'
import { TreeRenderer, useTreeValues } from '@/plugin-kit/TreeRenderer'

const id = decodeURIComponent(location.hash.slice(1))

/** A dialog a plugin asked for (llamarun.ui.confirm / prompt / select / form / alert). */
export function DialogApp() {
  const [request, setRequest] = useState<PluginDialogRequest | null>(null)
  const [values, setValue] = useTreeValues(request?.fields)
  const content = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.pluginDialog.get(id).then((r) => {
      if (r) {
        setRequest(r)
        document.title = `${r.plugin}: ${r.title}`
      } else window.close()
    })
  }, [])

  // Size the window to the content, then the main process shows it.
  useLayoutEffect(() => {
    if (!request || !content.current) return
    const el = content.current
    const report = (): void => void api.pluginDialog.resize(id, el.scrollHeight)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [request])

  if (!request) return null
  const resolve = (value: unknown): void => void api.pluginDialog.resolve(id, value)
  const submit = (): void => resolve(request.kind === 'form' ? values : true)

  return (
    <div ref={content} className="flex flex-col bg-background text-foreground">
      <TitleBar>
        {request.icon ? <img src={request.icon} alt="" className="size-4 rounded-sm" /> : <Blocks className="size-4 text-muted-foreground" />}
        <span className="truncate text-xs text-muted-foreground">{request.plugin}</span>
      </TitleBar>
      <form
        className="flex flex-col gap-4 px-5 pt-1 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') resolve(request.kind === 'confirm' ? false : null)
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-base font-semibold">{request.title}</h1>
          {request.message && (
            <p className="text-sm whitespace-pre-wrap text-muted-foreground" data-selectable>
              {request.message}
            </p>
          )}
        </div>
        {request.kind === 'form' && request.fields && (
          <TreeRenderer tree={request.fields} values={values} onChange={setValue} />
        )}
        <div className="flex justify-end gap-2 pt-1">
          {request.kind !== 'alert' && (
            <Button type="button" variant="outline" onClick={() => resolve(request.kind === 'confirm' ? false : null)}>
              {request.cancelLabel ?? 'Cancel'}
            </Button>
          )}
          <Button type="submit" variant={request.destructive ? 'destructive' : 'default'} autoFocus={request.kind !== 'form'}>
            {request.confirmLabel ?? 'OK'}
          </Button>
        </div>
      </form>
    </div>
  )
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ModelMenu } from '@/components/chat/ModelPicker'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, useIpcEvent } from '@/hooks/use-llamarun'

/**
 * The overlay's model dropdown, shown in its own small window under the model
 * button (see src/main/windows/modelMenu.ts). The window is reused: each time it
 * opens, the list starts over on the current model.
 */
export function ModelMenuApp() {
  const [value, setValue] = useState<string | null>(null)
  const [session, setSession] = useState(0)
  const root = useRef<HTMLDivElement>(null)

  useIpcEvent(
    'modelMenu:show',
    useCallback((p) => {
      setValue(p.value)
      setSession((s) => s + 1)
    }, [])
  )

  // The window opens hidden and is focused afterwards; put the cursor in the search field then.
  useEffect(() => {
    const focus = (): void => root.current?.querySelector('input')?.focus()
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])

  // The window is as tall as the list (the main process caps it at the screen edge).
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const report = (): void => void api.modelMenu.resize(Math.ceil(el.getBoundingClientRect().height))
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <TooltipProvider>
      <div ref={root}>
        {value !== null && (
          <ModelMenu
            key={session}
            value={value}
            onChoose={(id) => void api.modelMenu.choose(id)}
            onCancel={() => void api.modelMenu.close()}
            listClassName="max-h-[22rem]"
          />
        )}
      </div>
    </TooltipProvider>
  )
}

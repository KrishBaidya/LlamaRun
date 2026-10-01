import { Component, useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { PluginViewInit, UiNode } from '@shared/types'
import { TitleBar } from '@/components/TitleBar'
import { Toaster } from '@/components/ui/sonner'
import { applyAppearance, errorMessage } from '@/lib/utils'
import { TreeRenderer, useTreeValues } from '@/plugin-kit/TreeRenderer'
import { PanelContext, panelStore } from './runtime'

const view = window.llamarunView!

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    return this.state.error ? <ErrorPanel title="This panel crashed" detail={`${this.state.error.message}\n${this.state.error.stack ?? ''}`} /> : this.props.children
  }
}

function ErrorPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="m-4 flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <pre className="mt-1 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground" data-selectable>
          {detail}
        </pre>
      </div>
    </div>
  )
}

function PythonView({ initial }: { initial: UiNode }) {
  const [tree, setTree] = useState<UiNode>(initial)
  const [values, setValue] = useTreeValues(tree)
  useEffect(() => view.onTree(setTree), [])
  const invoke = useCallback((id: string, args: unknown[]) => {
    view.send('$callback', args, id).catch((err) => toast.error(errorMessage(err)))
  }, [])
  return <TreeRenderer tree={tree} values={values} onChange={setValue} onCallback={invoke} className="p-4 pt-1" />
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`could not load ${src}`))
    document.head.appendChild(el)
  })
}

function TsxView({ init }: { init: PluginViewInit }) {
  const [Panel, setPanel] = useState<ComponentType | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    panelStore.set(init.state ?? {})
    const off = view.onState((s) => panelStore.set(s))
    if (init.stylesheet) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = init.stylesheet
      document.head.appendChild(link)
    }
    loadScript(init.bundle!)
      .then(() => {
        const mod = (window as unknown as { __llamarunPanel?: { default?: ComponentType } }).__llamarunPanel
        if (!mod?.default) throw new Error('The panel file must `export default` a React component.')
        setPanel(() => mod.default!)
      })
      .catch((err) => setError(errorMessage(err)))
    return off
  }, [init])
  if (error) return <ErrorPanel title="Couldn't load this panel" detail={error} />
  if (!Panel) return <Loading />
  return (
    <Boundary>
      <Panel />
    </Boundary>
  )
}

function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <LoaderCircle className="size-5 animate-spin" />
    </div>
  )
}

export function PluginViewApp() {
  const [init, setInit] = useState<PluginViewInit | null>(null)
  const [title, setTitle] = useState('')
  useEffect(() => {
    if (title) document.title = title
  }, [title])
  useEffect(() => {
    void view.init().then((i) => {
      applyAppearance(i.appearance)
      setTitle(i.title)
      setInit(i)
    })
    const offTitle = view.onTitle(setTitle)
    const offAppearance = view.onAppearance(applyAppearance)
    return () => {
      offTitle()
      offAppearance()
    }
  }, [])

  return (
    <PanelContext.Provider value={{ pluginId: init?.pluginId ?? '', pluginName: init?.pluginName ?? '', title }}>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TitleBar>
          <span className="truncate text-sm font-medium">{title}</span>
          {init && <span className="truncate text-xs text-muted-foreground">{init.pluginName}</span>}
        </TitleBar>
        <main className="flex min-h-0 flex-1 flex-col overflow-auto">
          {!init ? (
            <Loading />
          ) : init.error ? (
            <ErrorPanel title="Couldn't build this panel" detail={init.error} />
          ) : init.bundle ? (
            <TsxView init={init} />
          ) : init.tree ? (
            <PythonView initial={init.tree} />
          ) : null}
        </main>
      </div>
      <Toaster position="bottom-center" />
    </PanelContext.Provider>
  )
}

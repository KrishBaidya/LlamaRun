import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { Blocks } from 'lucide-react'
import { toast } from 'sonner'
import type { UiNode } from '@shared/types'
import { api, useIpcEvent } from '@/hooks/use-llamarun'
import { usePluginSurfaces } from '@/hooks/use-plugin-surfaces'
import { TreeRenderer, useTreeValues } from '@/plugin-kit/TreeRenderer'
import { EmptyState, Page, PageHeader } from '../components'

function PageTree({ plugin, id, tree }: { plugin: string; id: string; tree: UiNode }) {
  const [values, setValue] = useTreeValues(tree)
  const invoke = useCallback(
    (cb: string, args: unknown[]) => {
      api.plugins.pageEvent(plugin, id, '$callback', args, cb).catch((err: unknown) => toast.error(String((err as Error)?.message ?? err)))
    },
    [plugin, id]
  )
  return <TreeRenderer tree={tree} values={values} onChange={setValue} onCallback={invoke} />
}

/** A page a plugin added to Settings (SDK 1.6), drawn from its Python View like a panel. */
export function PluginPage() {
  const { plugin = '', page = '' } = useParams()
  const { settingsPages } = usePluginSurfaces()
  const info = settingsPages.find((p) => p.plugin === plugin && p.id === page)
  const [tree, setTree] = useState<UiNode | null>(null)

  useEffect(() => {
    setTree(null)
    void api.plugins.page(plugin, page).then(setTree)
  }, [plugin, page])
  useIpcEvent(
    'plugins:pageTree',
    useCallback((e: { plugin: string; id: string; tree: UiNode }) => e.plugin === plugin && e.id === page && setTree(e.tree), [plugin, page])
  )

  if (!info)
    return (
      <Page>
        <EmptyState icon={<Blocks />} title="This page is gone">
          The plugin that added it was turned off or stopped.
        </EmptyState>
      </Page>
    )
  return (
    <Page>
      <PageHeader title={info.title} description={`From ${info.pluginName}`} />
      {tree && <PageTree key={`${plugin}:${page}`} plugin={plugin} id={page} tree={tree} />}
    </Page>
  )
}

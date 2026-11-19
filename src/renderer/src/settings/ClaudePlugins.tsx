import { useEffect, useState } from 'react'
import { Package, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { BundleInfo, BundlePreview } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/hooks/use-llamarun'
import { errorMessage } from '@/lib/utils'

function Section({ title, items, mono }: { title: string; items: string[]; mono?: boolean }) {
  if (!items.length) return null
  return (
    <div>
      <p className="text-xs font-medium">{title}</p>
      <ul className="mt-0.5 list-disc ps-5 text-xs text-muted-foreground">
        {items.map((i) => (
          <li key={i} className={mono ? 'font-mono break-all' : undefined}>
            {i}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Installing Claude Code plugins: everything they add is shown before anything is installed. */
export function ClaudePlugins() {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [staged, setStaged] = useState<{ token: string; preview: BundlePreview } | null>(null)
  const [installed, setInstalled] = useState<BundleInfo[]>([])

  useEffect(() => void api.bundles.list().then(setInstalled), [])

  const inspect = (): void => {
    setBusy(true)
    void api.bundles
      .inspect(input)
      .then(setStaged)
      .catch((err) => toast.error(errorMessage(err)))
      .finally(() => setBusy(false))
  }
  const install = (): void => {
    if (!staged) return
    setBusy(true)
    void api.bundles
      .install(staged.token)
      .then((list) => {
        setInstalled(list)
        toast.success(`Installed ${staged.preview.name}`)
        setStaged(null)
        setInput('')
      })
      .catch((err) => toast.error(errorMessage(err)))
      .finally(() => setBusy(false))
  }
  const cancel = (): void => {
    if (staged) void api.bundles.cancel(staged.token)
    setStaged(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="size-4" /> Claude Code plugins
        </CardTitle>
        <CardDescription>
          Install a Claude Code plugin from a GitHub link or a folder: its skills, commands (as /commands), agents, hooks and MCP servers are added to Llama Run. You see everything it adds first.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!staged ? (
          <div className="flex gap-2">
            <Input placeholder="https://github.com/owner/plugin or C:\path\to\plugin" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && input.trim() && inspect()} />
            <Button variant="outline" disabled={!input.trim() || busy} onClick={inspect}>
              Look inside
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-sm font-medium">
              {staged.preview.name}
              {staged.preview.version ? <span className="ms-1.5 text-xs text-muted-foreground">v{staged.preview.version}</span> : null}
            </p>
            {staged.preview.description && <p className="text-xs text-muted-foreground">{staged.preview.description}</p>}
            <Section title="Skills" items={staged.preview.skills} />
            <Section title="Commands" items={staged.preview.commands.map((c) => `/${c}`)} />
            <Section title="Agents (added as skills a sub-agent can follow)" items={staged.preview.agents} />
            <Section title="Hooks: these commands run on your PC without asking" items={staged.preview.hooks} mono />
            <Section title="MCP servers: these programs start with Llama Run" items={staged.preview.mcpServers} mono />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={install}>
                Install
              </Button>
            </div>
          </div>
        )}
        {installed.length > 0 && (
          <div className="divide-y rounded-lg border">
            {installed.map((b) => (
              <div key={b.name} className="flex items-start gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{b.name}</p>
                  <p className="text-2xs text-muted-foreground">
                    {[b.skills.length && `${b.skills.length} skills/commands`,b.mcpServers.length && `${b.mcpServers.length} MCP servers`].filter(Boolean).join(' · ') ||
                      'Hooks only'}
                  </p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Remove the plugin and everything it added"
                  onClick={() => void api.bundles.remove(b.name).then(setInstalled).catch((err) => toast.error(errorMessage(err)))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

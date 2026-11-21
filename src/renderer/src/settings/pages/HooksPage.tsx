import { useEffect, useState } from 'react'
import { Download, Webhook } from 'lucide-react'
import { toast } from 'sonner'
import type { HookConfig, HookEvent } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/hooks/use-llamarun'
import { errorMessage } from '@/lib/utils'
import { Page, PageHeader } from '../components'

const EVENTS: { event: HookEvent; when: string }[] = [
  { event: 'SessionStart', when: 'A new chat starts. What it prints joins the prompt.' },
  { event: 'UserPromptSubmit', when: 'You send a message. Exit code 2 stops it; what it prints joins the prompt.' },
  { event: 'PreToolUse', when: 'Before a tool runs. Exit code 2 blocks it and tells the model why.' },
  { event: 'PostToolUse', when: 'After a tool runs. What it prints (or exit code 2) is added to the result.' },
  { event: 'Stop', when: 'A reply finishes. Exit code 2 sends the reason back so the model keeps going.' }
]

const EXAMPLE: HookConfig = {
  PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'npx prettier --write $env:CLAUDE_PROJECT_DIR' }] }]
}

/** The user's own commands at points in a chat's life, in Claude Code's format. */
export function HooksPage() {
  const [config, setConfig] = useState<HookConfig | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.hooks.get().then((c) => {
      setConfig(c)
      setText(JSON.stringify(c, null, 2))
    })
  }, [])

  const save = (value = text): void => {
    let parsed: HookConfig
    try {
      parsed = JSON.parse(value || '{}') as HookConfig
    } catch (err) {
      setError(`Not valid JSON: ${(err as Error).message}`)
      return
    }
    void api.hooks
      .save(parsed)
      .then((saved) => {
        setConfig(saved)
        setText(JSON.stringify(saved, null, 2))
        setError(null)
        toast.success('Hooks saved')
      })
      .catch((err) => setError(errorMessage(err)))
  }

  const importClaude = (): void =>
    void api.hooks.claudeCode().then((hooks) => {
      if (!hooks || !Object.keys(hooks).length) return toast.info("Claude Code's settings have no hooks Llama Run can run.")
      const merged: HookConfig = { ...(config ?? {}) }
      for (const [event, groups] of Object.entries(hooks) as [HookEvent, NonNullable<HookConfig[HookEvent]>][]) merged[event] = [...(merged[event] ?? []), ...groups]
      setText(JSON.stringify(merged, null, 2))
      toast.info("Claude Code's hooks are added below. Check them, then Save.")
    })

  const count = (event: HookEvent): number => config?.[event]?.reduce((n, g) => n + g.hooks.length, 0) ?? 0

  return (
    <Page>
      <PageHeader
        title="Hooks"
        description="Your own commands that run at points in a chat, in the same format as Claude Code's hooks: each gets the event as JSON on stdin, and its exit code and output decide what happens. They run on the same events as plugin hooks, before any plugin's: UserPromptSubmit and SessionStart before a reply, PreToolUse and PostToolUse around tool calls, Stop when a reply ends. They run without asking, so only add commands you trust."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="size-4" /> When they run
          </CardTitle>
          <CardDescription>A matcher (for the tool events) is a pattern of tool names: Llama Run's (run_command, write_file) or Claude Code's (Bash, Write|Edit).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {EVENTS.map(({ event, when }) => (
            <div key={event} className="flex items-start gap-3 text-sm">
              <code className="w-36 shrink-0 text-xs">{event}</code>
              <span className="flex-1 text-xs text-muted-foreground">{when}</span>
              {count(event) > 0 && <Badge variant="secondary">{count(event)}</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>hooks.json</CardTitle>
          <CardDescription>
            Commands run in PowerShell, starting in the chat's folder; $env:CLAUDE_PROJECT_DIR and $env:LLAMARUN_CHAT_ID are set.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            rows={14}
            spellCheck={false}
            className="font-mono text-xs"
            value={text}
            placeholder={JSON.stringify(EXAMPLE, null, 2)}
            onChange={(e) => setText(e.target.value)}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save()}>Save</Button>
            <Button variant="outline" onClick={importClaude}>
              <Download /> Add Claude Code's hooks
            </Button>
            {!text.trim() || text.trim() === '{}' ? (
              <Button variant="ghost" onClick={() => setText(JSON.stringify(EXAMPLE, null, 2))}>
                Show an example
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </Page>
  )
}

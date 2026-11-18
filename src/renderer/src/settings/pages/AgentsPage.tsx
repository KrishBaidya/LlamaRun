import { useEffect, useState } from 'react'
import { Bot, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentInfo, AgentInput } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { modelName, useModelCatalog } from '@/components/chat/ModelPicker'
import { api } from '@/hooks/use-llamarun'
import { errorMessage } from '@/lib/utils'
import { EmptyState, Page, PageHeader } from '../components'

const READ_ONLY = ['read_file', 'file_list', 'file_glob', 'file_grep', 'web_fetch', 'web_search', 'chat_search', 'chat_read', 'skill_load', 'skill_read_file', 'todo_update']
const SOURCE: Record<AgentInfo['location'], string> = { llamarun: 'Llama Run', claude: 'Claude Code', opencode: 'OpenCode' }
const CHAT_MODEL = '__chat__'

type Access = 'read' | 'all' | 'custom'

function accessOf(tools: AgentInfo['tools']): Access {
  if (tools === '*') return 'all'
  return tools.length === READ_ONLY.length && READ_ONLY.every((t) => tools.includes(t)) ? 'read' : 'custom'
}

function toolSummary(tools: AgentInfo['tools']): string {
  const access = accessOf(tools)
  if (access === 'all') return 'Every tool'
  if (access === 'read') return 'Reads and looks up only'
  return (tools as string[]).join(', ')
}

const blank: AgentInput = { name: '', description: '', tools: READ_ONLY, prompt: '' }

function AgentForm({ initial, onDone }: { initial: AgentInput; onDone: () => void }) {
  const catalog = useModelCatalog()
  const [draft, setDraft] = useState<AgentInput>(initial)
  const [access, setAccess] = useState<Access>(accessOf(initial.tools))
  const [custom, setCustom] = useState(initial.tools === '*' ? '' : initial.tools.join(', '))
  const set = <K extends keyof AgentInput>(key: K, value: AgentInput[K]): void => setDraft((d) => ({ ...d, [key]: value }))
  const models = catalog?.groups.flatMap((g) => g.models) ?? []

  const save = (): void => {
    const tools = access === 'all' ? '*' : access === 'read' ? READ_ONLY : custom.split(',').map((t) => t.trim()).filter(Boolean)
    void api.agents
      .save({ ...draft, tools })
      .then(() => {
        toast.success(`Saved ${draft.name}`)
        onDone()
      })
      .catch((err) => toast.error(errorMessage(err)))
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-name">Name</Label>
          <Input id="agent-name" placeholder="researcher" value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Model</Label>
          <Select value={draft.model ?? CHAT_MODEL} onValueChange={(v) => set('model', v === CHAT_MODEL ? undefined : v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CHAT_MODEL}>The chat's model</SelectItem>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
              {draft.model && !models.some((m) => m.id === draft.model) && <SelectItem value={draft.model}>{draft.model}</SelectItem>}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-description">What it's for</Label>
        <Input
          id="agent-description"
          placeholder="Researches a question on the web and reports sources"
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Tools</Label>
        <Select value={access} onValueChange={(v) => setAccess(v as Access)}>
          <SelectTrigger className="sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="read">Reads and looks up only</SelectItem>
            <SelectItem value="all">Every tool (commands and file changes still ask)</SelectItem>
            <SelectItem value="custom">Only these…</SelectItem>
          </SelectContent>
        </Select>
        {access === 'custom' && (
          <Input placeholder="read_file, file_grep, write_file, run_command" value={custom} onChange={(e) => setCustom(e.target.value)} />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-prompt">Instructions</Label>
        <Textarea id="agent-prompt" rows={6} placeholder="How it should work and what it should report." value={draft.prompt} onChange={(e) => set('prompt', e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!draft.name.trim() || !draft.description.trim()}>
          Save
        </Button>
      </div>
    </div>
  )
}

/** Custom agents: a prompt with its own model and tools, for a chat to run as or for agent_run to hand work to. */
export function AgentsPage() {
  const catalog = useModelCatalog()
  const [agents, setAgents] = useState<AgentInfo[] | null>(null)
  const [editing, setEditing] = useState<AgentInput | null>(null)

  const load = (): void => void api.agents.list().then(setAgents)
  useEffect(load, [])

  const remove = (agent: AgentInfo): void =>
    void api.agents
      .delete(agent.id)
      .then(setAgents)
      .catch((err) => toast.error(errorMessage(err)))

  return (
    <Page>
      <PageHeader
        title="Agents"
        description="An agent is a set of instructions with its own model and tools. Pick one in the chat box to run a chat as it, or let the model hand it a task (agent_run). Agents from Claude Code (~/.claude/agents) and OpenCode show here too."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4" /> Your agents
          </CardTitle>
          <CardDescription>Without its own tools, an agent can only read files and look things up.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {agents && !agents.length && !editing ? (
            <EmptyState icon={<Bot />} title="No agents yet">
              Add one for a job you do often: a researcher, a reviewer, a writer.
            </EmptyState>
          ) : (
            <div className="divide-y">
              {agents?.map((a) => (
                <div key={a.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {a.name}
                      {a.location !== 'llamarun' && <Badge variant="secondary">{SOURCE[a.location]}</Badge>}
                    </p>
                    {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {a.model ? modelName(catalog, a.model) : "The chat's model"} · {toolSummary(a.tools)}
                    </p>
                  </div>
                  {a.location === 'llamarun' && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Edit"
                        onClick={() => setEditing({ id: a.id, name: a.name, description: a.description, model: a.model, tools: a.tools, thinking: a.thinking, prompt: a.prompt })}
                      >
                        <Pencil />
                      </Button>
                      <Button size="icon-sm" variant="ghost" title="Remove" onClick={() => remove(a)}>
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {editing ? (
            <AgentForm
              key={editing.id ?? 'new'}
              initial={editing}
              onDone={() => {
                setEditing(null)
                load()
              }}
            />
          ) : (
            <Button variant="outline" className="self-start" onClick={() => setEditing(blank)}>
              <Plus /> Add agent
            </Button>
          )}
        </CardContent>
      </Card>
    </Page>
  )
}

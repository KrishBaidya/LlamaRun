import { useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import type { McpServerConfig } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/hooks/use-llamarun'
import { errorMessage } from '@/lib/utils'

export const EMPTY_SERVER: McpServerConfig = {
  name: 'my-server',
  mcpType: 'STDIO',
  data: { Command: 'npx', Arguments: ['-y', 'package-name'], EnvironmentVariables: {}, URL: null }
}

/** Editable JSON preview of an mcp.json entry (port of ServerInstallPreviewDialog). */
export function McpConfigDialog({
  config,
  open,
  onOpenChange,
  onSaved
}: {
  config: McpServerConfig | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && config) {
      setText(JSON.stringify(config, null, 4))
      setError(null)
    }
  }, [open, config])

  const placeholders = /<[^>]+>|YOUR_|your[-_]/i.test(text)

  const save = async (): Promise<void> => {
    let parsed: McpServerConfig
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      setError(`Invalid JSON: ${(err as Error).message}`)
      return
    }
    setSaving(true)
    try {
      await api.mcp.saveServer(parsed)
      toast.success(`${parsed.name} installed`)
      onOpenChange(false)
      onSaved?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-5" /> MCP Server Configuration
          </DialogTitle>
          <DialogDescription>
            Review and edit the configuration before installing. Fill in any API keys under EnvironmentVariables.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault()
              const el = e.currentTarget
              const { selectionStart: s, selectionEnd: end } = el
              const next = text.slice(0, s) + '    ' + text.slice(end)
              setText(next)
              requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4))
            }
          }}
          className="h-80 font-mono text-xs [field-sizing:fixed]"
        />
        {placeholders && !error && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            This configuration contains placeholder values. Replace them before saving.
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            Save &amp; Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

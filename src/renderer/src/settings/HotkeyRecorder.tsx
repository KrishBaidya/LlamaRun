import { useState } from 'react'
import { Keyboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const isMac = window.llamarun.platform === 'darwin'

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  '`': '`',
  '-': '-',
  '=': '=',
  '[': '[',
  ']': ']',
  ';': ';',
  "'": "'",
  ',': ',',
  '.': '.',
  '/': '/',
  '\\': '\\'
}

/** Converts a keyboard event into an Electron accelerator, or null if incomplete. */
export function acceleratorFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  let key: string | undefined
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) key = e.key
  else key = KEY_NAMES[e.key]
  if (!key) return null

  const mods: string[] = []
  if (e.ctrlKey || (isMac && e.metaKey)) mods.push('CommandOrControl')
  if (!isMac && e.metaKey) mods.push('Super')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  // Plain letters would swallow normal typing system-wide.
  if (!mods.length && !/^F\d+$/.test(key)) return null
  return [...mods, key].join('+')
}

export function prettyAccelerator(acc: string): string[] {
  return acc.split('+').map((part) => (part === 'CommandOrControl' ? (isMac ? '⌘' : 'Ctrl') : part === 'Super' ? 'Win' : part))
}

export function Keycaps({ accelerator, className }: { accelerator: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {prettyAccelerator(accelerator).map((k, i) => (
        <kbd key={i} className="rounded-md border bg-background/70 px-2 py-0.5 font-mono text-xs shadow-xs">
          {k}
        </kbd>
      ))}
    </span>
  )
}

export function HotkeyRecorder({ value, onChange }: { value: string; onChange: (acc: string) => void }) {
  const [recording, setRecording] = useState(false)
  return (
    <Button
      variant="outline"
      className={cn('min-w-44 justify-start', recording && 'ring-[3px] ring-ring/50')}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return
        e.preventDefault()
        if (e.key === 'Escape') return setRecording(false)
        const acc = acceleratorFromEvent(e)
        if (acc) {
          onChange(acc)
          setRecording(false)
        }
      }}
    >
      <Keyboard />
      {recording ? <span className="text-muted-foreground">Press a shortcut…</span> : <Keycaps accelerator={value} />}
    </Button>
  )
}

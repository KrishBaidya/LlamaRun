import { ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Plan mode: the model only reads and looks things up until it's turned off. */
export function PlanToggle({ value, onChange, disabled }: { value: boolean; onChange: (plan: boolean) => void; disabled?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      aria-pressed={value}
      title={value ? 'Plan mode is on: the model only reads and looks things up. Click to let it act.' : 'Plan mode: the model only reads and looks things up, and plans before acting'}
      className={cn('gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground', value && 'bg-accent text-foreground')}
      onClick={() => onChange(!value)}
    >
      <ClipboardList className="size-3.5" />
      <span>Plan</span>
    </Button>
  )
}

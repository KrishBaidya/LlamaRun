import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, LoaderCircle } from 'lucide-react'
import type { UiNode } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Markdown } from '@/components/markdown'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Icon } from './icons'

/**
 * Renders UI trees built with the Python SDK (llamarun.ui) using the app's
 * own components. Plugin code never runs here: a tree is plain data, and
 * callbacks are ids that are sent back to the plugin.
 */

export type Values = Record<string, unknown>

interface TreeContextValue {
  values: Values
  setValue: (name: string, value: unknown) => void
  /** Invoke a Python callback by id. Absent in settings forms and dialogs. */
  invoke?: (id: string, args: unknown[]) => void
  disabled?: boolean
}

const TreeContext = createContext<TreeContextValue>({ values: {}, setValue: () => {} })

type Props = Record<string, unknown>

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v))
const cb = (v: unknown): string | undefined =>
  v && typeof v === 'object' && '$cb' in v ? String((v as { $cb: unknown }).$cb) : undefined

/** Every input's name and default in a tree. */
export function collectDefaults(nodes: UiNode | UiNode[] | null | undefined, out: Values = {}): Values {
  for (const node of Array.isArray(nodes) ? nodes : nodes ? [nodes] : []) {
    const name = node.props?.name
    if (typeof name === 'string') out[name] = node.props?.default ?? null
    if (node.children) collectDefaults(node.children, out)
  }
  return out
}

/**
 * Local input values for a tree, reset to a field's default whenever Python
 * sends a different default (that's how a plugin sets an input's value).
 */
export function useTreeValues(tree: UiNode | UiNode[] | null | undefined, initial?: Values): [Values, (name: string, value: unknown) => void, (v: Values) => void] {
  const [values, setValues] = useState<Values>(() => ({ ...collectDefaults(tree), ...initial }))
  const defaults = useRef<Values>(collectDefaults(tree))
  useEffect(() => {
    const next = collectDefaults(tree)
    const prev = defaults.current
    defaults.current = next
    setValues((current) => {
      const merged: Values = {}
      for (const [k, v] of Object.entries(next)) {
        merged[k] = k in current && JSON.stringify(prev[k]) === JSON.stringify(v) ? current[k] : v
      }
      return merged
    })
  }, [tree])
  return [values, (name, value) => setValues((v) => ({ ...v, [name]: value })), setValues]
}

export function TreeRenderer({
  tree,
  values,
  onChange,
  onCallback,
  disabled,
  className
}: {
  tree: UiNode | UiNode[] | null | undefined
  values: Values
  onChange: (name: string, value: unknown) => void
  onCallback?: (id: string, args: unknown[]) => void
  disabled?: boolean
  className?: string
}) {
  const nodes = Array.isArray(tree) ? tree : tree ? [tree] : []
  return (
    <TreeContext.Provider value={{ values, setValue: onChange, invoke: onCallback, disabled }}>
      <div className={cn('flex flex-col gap-4', className)}>
        {nodes.map((n, i) => (
          <RenderNode key={i} node={n} />
        ))}
      </div>
    </TreeContext.Provider>
  )
}

function Children({ node }: { node: UiNode }) {
  return (
    <>
      {(node.children ?? []).map((child, i) => (
        <RenderNode key={i} node={child} />
      ))}
    </>
  )
}

const ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' }
const JUSTIFY: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' }
const TONE: Record<string, string> = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  destructive: 'text-destructive'
}
const SIZE: Record<string, string> = { xs: 'text-xs', sm: 'text-sm', base: 'text-base', lg: 'text-lg' }
const WEIGHT: Record<string, string> = { normal: 'font-normal', medium: 'font-medium', semibold: 'font-semibold' }

function gap(value: unknown, fallback: number): CSSProperties {
  const n = typeof value === 'number' ? value : fallback
  return { gap: `${Math.max(0, Math.min(16, n)) * 0.25}rem` }
}

function Field({ props, children, inline }: { props: Props; children: ReactNode; inline?: boolean }) {
  const label = str(props.label)
  const description = str(props.description)
  const id = `field-${str(props.name)}`
  if (inline) {
    return (
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          {label && (
            <Label htmlFor={id} className="text-sm font-normal">
              {label}
            </Label>
          )}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {children}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      {label && <Label htmlFor={id}>{label}</Label>}
      {children}
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}

/** Sends on_change to Python, debounced for text so every keystroke isn't a round trip. */
function useChangeCallback(props: Props, debounceMs: number): (value: unknown) => void {
  const { invoke } = useContext(TreeContext)
  const id = cb(props.on_change)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  return (value) => {
    if (!id || !invoke) return
    if (timer.current) clearTimeout(timer.current)
    if (debounceMs <= 0) invoke(id, [value])
    else timer.current = setTimeout(() => invoke(id, [value]), debounceMs)
  }
}

function RenderNode({ node }: { node: UiNode }) {
  const ctx = useContext(TreeContext)
  const p: Props = node.props ?? {}
  const name = str(p.name)
  const value = name ? ctx.values[name] : undefined
  const fieldId = `field-${name}`

  switch (node.type) {
    case 'Column':
      return (
        <div className="flex min-w-0 flex-col" style={{ ...gap(p.gap, 3), alignItems: ALIGN[str(p.align)] }}>
          <Children node={node} />
        </div>
      )
    case 'Row':
      return (
        <div
          className={cn('flex min-w-0 flex-row', p.wrap ? 'flex-wrap' : '')}
          style={{ ...gap(p.gap, 2), alignItems: ALIGN[str(p.align, 'center')], justifyContent: JUSTIFY[str(p.justify)] }}
        >
          <Children node={node} />
        </div>
      )
    case 'Card':
      return (
        <Card className="gap-3">
          {p.title || p.description ? (
            <CardHeader>
              {p.title ? <CardTitle>{str(p.title)}</CardTitle> : null}
              {p.description ? <CardDescription>{str(p.description)}</CardDescription> : null}
            </CardHeader>
          ) : null}
          <CardContent className="flex flex-col gap-3">
            <Children node={node} />
          </CardContent>
        </Card>
      )
    case 'Heading': {
      const level = Number(p.level) || 2
      const cls = level === 1 ? 'text-xl font-semibold' : level === 3 ? 'text-sm font-semibold' : 'text-base font-semibold'
      return level === 1 ? <h1 className={cls}>{str(p.text)}</h1> : level === 3 ? <h3 className={cls}>{str(p.text)}</h3> : <h2 className={cls}>{str(p.text)}</h2>
    }
    case 'Text':
      return (
        <p
          className={cn('whitespace-pre-wrap', TONE[str(p.tone, 'default')], SIZE[str(p.size, 'sm')], WEIGHT[str(p.weight)])}
          data-selectable={p.selectable === false ? undefined : true}
        >
          {str(p.text)}
        </p>
      )
    case 'Markdown':
      return <Markdown text={str(p.text)} className="text-sm" />
    case 'Code':
      return <Markdown text={`\`\`\`${str(p.language)}\n${str(p.text)}\n\`\`\``} className="text-sm" />
    case 'Separator':
      return <Separator />
    case 'Image': {
      const src = str(p.src)
      if (!/^(data:|blob:)/.test(src)) return null
      return (
        <img
          src={src}
          alt={str(p.alt)}
          width={typeof p.width === 'number' ? p.width : undefined}
          height={typeof p.height === 'number' ? p.height : undefined}
          className={cn('max-w-full object-contain', p.rounded === false ? '' : 'rounded-lg')}
        />
      )
    }
    case 'Callout': {
      const tone = str(p.tone, 'default')
      const IconFor = tone === 'destructive' || tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info
      return (
        <div
          className={cn(
            'flex gap-3 rounded-lg border px-3 py-2.5 text-sm',
            tone === 'destructive' && 'border-destructive/40 bg-destructive/5',
            tone === 'warning' && 'border-amber-500/40 bg-amber-500/5',
            tone === 'success' && 'border-emerald-500/40 bg-emerald-500/5'
          )}
        >
          <IconFor className={cn('mt-0.5 size-4 shrink-0', TONE[tone])} />
          <div className="flex min-w-0 flex-col gap-0.5">
            {p.title ? <div className="font-medium">{str(p.title)}</div> : null}
            <div className="whitespace-pre-wrap text-muted-foreground" data-selectable>
              {str(p.text)}
            </div>
          </div>
        </div>
      )
    }
    case 'Badge': {
      const variant = (['default', 'secondary', 'outline', 'success', 'destructive'] as const).find((v) => v === p.variant) ?? 'secondary'
      return <Badge variant={variant}>{str(p.text)}</Badge>
    }
    case 'Progress': {
      const pct = typeof p.value === 'number' ? Math.max(0, Math.min(100, p.value)) : null
      return (
        <div className="flex flex-col gap-1.5">
          {p.label ? <div className="text-xs text-muted-foreground">{str(p.label)}</div> : null}
          <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
            {pct === null ? (
              <div className="absolute inset-y-0 w-1/3 animate-[progress-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
            ) : (
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
            )}
          </div>
        </div>
      )
    }
    case 'Spinner':
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {p.label ? str(p.label) : null}
        </div>
      )
    case 'List':
      return (
        <ul className={cn('flex flex-col', p.dividers === false ? 'gap-1' : 'divide-y rounded-lg border')}>
          {(node.children ?? []).map((child, i) => (
            <li key={i} className={p.dividers === false ? '' : 'px-3 py-2'}>
              <RenderNode node={child} />
            </li>
          ))}
        </ul>
      )
    case 'Button': {
      const id = cb(p.on_click)
      const variant = (['default', 'secondary', 'outline', 'ghost', 'destructive'] as const).find((v) => v === p.variant) ?? 'default'
      const size = (['sm', 'default', 'lg'] as const).find((v) => v === p.size) ?? 'default'
      return (
        <Button
          variant={variant}
          size={size}
          className="w-fit"
          disabled={ctx.disabled || !!p.disabled || !id || !ctx.invoke}
          onClick={() => id && ctx.invoke?.(id, [ctx.values])}
        >
          {p.icon ? <Icon name={str(p.icon)} /> : null}
          {str(p.label)}
        </Button>
      )
    }
    case 'Input':
      return <InputField p={p} id={fieldId} value={value} />
    case 'Textarea':
      return <TextareaField p={p} id={fieldId} value={value} />
    case 'Switch':
    case 'Checkbox':
      return <ToggleField p={p} id={fieldId} value={value} kind={node.type} />
    case 'Select':
      return <SelectField p={p} id={fieldId} value={value} />
    case 'Slider':
      return <SliderField p={p} id={fieldId} value={value} />
    default:
      return <div className="text-xs text-destructive">Unknown component “{node.type}”</div>
  }
}

function InputField({ p, id, value }: { p: Props; id: string; value: unknown }) {
  const ctx = useContext(TreeContext)
  const change = useChangeCallback(p, 300)
  const submit = cb(p.on_submit)
  const type = (['text', 'password', 'number', 'email', 'url'] as const).find((t) => t === p.inputType) ?? 'text'
  return (
    <Field props={p}>
      <Input
        id={id}
        type={type}
        value={str(value)}
        placeholder={str(p.placeholder) || undefined}
        disabled={ctx.disabled}
        onChange={(e) => {
          const v = type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value
          ctx.setValue(str(p.name), v)
          change(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && submit && ctx.invoke && !e.nativeEvent.isComposing) ctx.invoke(submit, [value])
        }}
      />
    </Field>
  )
}

function TextareaField({ p, id, value }: { p: Props; id: string; value: unknown }) {
  const ctx = useContext(TreeContext)
  const change = useChangeCallback(p, 300)
  return (
    <Field props={p}>
      <Textarea
        id={id}
        rows={Number(p.rows) || 4}
        value={str(value)}
        placeholder={str(p.placeholder) || undefined}
        disabled={ctx.disabled}
        onChange={(e) => {
          ctx.setValue(str(p.name), e.target.value)
          change(e.target.value)
        }}
      />
    </Field>
  )
}

function ToggleField({ p, id, value, kind }: { p: Props; id: string; value: unknown; kind: string }) {
  const ctx = useContext(TreeContext)
  const change = useChangeCallback(p, 0)
  const set = (v: boolean): void => {
    ctx.setValue(str(p.name), v)
    change(v)
  }
  if (kind === 'Checkbox') {
    return (
      <div className="flex items-start gap-2.5">
        <Checkbox id={id} checked={!!value} disabled={ctx.disabled} onCheckedChange={(v) => set(v === true)} className="mt-0.5" />
        <div className="flex flex-col gap-0.5">
          {p.label ? (
            <Label htmlFor={id} className="font-normal">
              {str(p.label)}
            </Label>
          ) : null}
          {p.description ? <p className="text-xs text-muted-foreground">{str(p.description)}</p> : null}
        </div>
      </div>
    )
  }
  return (
    <Field props={p} inline>
      <Switch id={id} checked={!!value} disabled={ctx.disabled} onCheckedChange={set} />
    </Field>
  )
}

function SelectField({ p, id, value }: { p: Props; id: string; value: unknown }) {
  const ctx = useContext(TreeContext)
  const change = useChangeCallback(p, 0)
  const options = Array.isArray(p.options) ? (p.options as { value: string; label: string }[]) : []
  return (
    <Field props={p}>
      <Select
        value={str(value)}
        disabled={ctx.disabled}
        onValueChange={(v) => {
          ctx.setValue(str(p.name), v)
          change(v)
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={str(p.placeholder) || 'Choose…'} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value || ' '}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function SliderField({ p, id, value }: { p: Props; id: string; value: unknown }) {
  const ctx = useContext(TreeContext)
  const change = useChangeCallback(p, 150)
  const min = Number(p.min ?? 0)
  const max = Number(p.max ?? 100)
  const current = typeof value === 'number' ? value : Number(p.default ?? min)
  return (
    <Field props={{ ...p, label: p.label ? `${str(p.label)}` : undefined }}>
      <div className="flex items-center gap-3">
        <Slider
          id={id}
          min={min}
          max={max}
          step={Number(p.step ?? 1)}
          value={[current]}
          disabled={ctx.disabled}
          onValueChange={([v]) => {
            ctx.setValue(str(p.name), v)
            change(v)
          }}
          className="flex-1"
        />
        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{current}</span>
      </div>
    </Field>
  )
}

// Types for `@llamarun/ui` in plugin panels (TSX). Llama Run provides these
// components at runtime: they are the app's own shadcn/ui components, so
// panels match the app. Tailwind classes work too; Llama Run generates the
// ones your panel uses when it compiles it.
import type * as React from 'react'

type Props<E extends keyof React.JSX.IntrinsicElements> = React.ComponentProps<E> & { className?: string }

export declare const Button: React.FC<
  Props<'button'> & {
    variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
    size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm'
    asChild?: boolean
  }
>
export declare const Badge: React.FC<Props<'span'> & { variant?: 'default' | 'secondary' | 'outline' | 'success' | 'destructive' }>
export declare const Card: React.FC<Props<'div'>>
export declare const CardHeader: React.FC<Props<'div'>>
export declare const CardTitle: React.FC<Props<'div'>>
export declare const CardDescription: React.FC<Props<'div'>>
export declare const CardAction: React.FC<Props<'div'>>
export declare const CardContent: React.FC<Props<'div'>>
export declare const CardFooter: React.FC<Props<'div'>>
export declare const Input: React.FC<Props<'input'>>
export declare const Textarea: React.FC<Props<'textarea'>>
export declare const Label: React.FC<Props<'label'>>
export declare const Separator: React.FC<Props<'div'> & { orientation?: 'horizontal' | 'vertical' }>
export declare const Skeleton: React.FC<Props<'div'>>
export declare const Checkbox: React.FC<
  Omit<Props<'button'>, 'onChange'> & { checked?: boolean | 'indeterminate'; onCheckedChange?: (checked: boolean | 'indeterminate') => void }
>
export declare const Switch: React.FC<Omit<Props<'button'>, 'onChange'> & { checked?: boolean; onCheckedChange?: (checked: boolean) => void }>
export declare const Slider: React.FC<
  Omit<Props<'span'>, 'defaultValue' | 'onChange'> & {
    value?: number[]
    defaultValue?: number[]
    min?: number
    max?: number
    step?: number
    onValueChange?: (value: number[]) => void
  }
>
export declare const Select: React.FC<{ value?: string; defaultValue?: string; onValueChange?: (value: string) => void; disabled?: boolean; children?: React.ReactNode }>
export declare const SelectTrigger: React.FC<Props<'button'>>
export declare const SelectValue: React.FC<{ placeholder?: React.ReactNode }>
export declare const SelectContent: React.FC<Props<'div'>>
export declare const SelectGroup: React.FC<Props<'div'>>
export declare const SelectLabel: React.FC<Props<'div'>>
export declare const SelectItem: React.FC<Props<'div'> & { value: string; disabled?: boolean }>
export declare const SelectSeparator: React.FC<Props<'div'>>
export declare const Tabs: React.FC<Props<'div'> & { value?: string; defaultValue?: string; onValueChange?: (value: string) => void }>
export declare const TabsList: React.FC<Props<'div'>>
export declare const TabsTrigger: React.FC<Props<'button'> & { value: string }>
export declare const TabsContent: React.FC<Props<'div'> & { value: string }>
export declare const ScrollArea: React.FC<Props<'div'>>
export declare const Tooltip: React.FC<{ children?: React.ReactNode; open?: boolean; delayDuration?: number }>
export declare const TooltipTrigger: React.FC<Props<'button'> & { asChild?: boolean }>
export declare const TooltipContent: React.FC<Props<'div'> & { side?: 'top' | 'right' | 'bottom' | 'left' }>
export declare const TooltipProvider: React.FC<{ children?: React.ReactNode; delayDuration?: number }>
export declare const Popover: React.FC<{ children?: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }>
export declare const PopoverTrigger: React.FC<Props<'button'> & { asChild?: boolean }>
export declare const PopoverContent: React.FC<Props<'div'> & { align?: 'start' | 'center' | 'end' }>
export declare const DropdownMenu: React.FC<{ children?: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }>
export declare const DropdownMenuTrigger: React.FC<Props<'button'> & { asChild?: boolean }>
export declare const DropdownMenuContent: React.FC<Props<'div'> & { align?: 'start' | 'center' | 'end' }>
export declare const DropdownMenuItem: React.FC<Props<'div'> & { onSelect?: (event: Event) => void; disabled?: boolean; variant?: 'default' | 'destructive' }>
export declare const DropdownMenuLabel: React.FC<Props<'div'>>
export declare const DropdownMenuSeparator: React.FC<Props<'div'>>

/** Chat-style Markdown with code highlighting. */
export declare const Markdown: React.FC<{ text: string; className?: string }>

/** Any Lucide icon by name: "trash-2" or "Trash2". See https://lucide.dev/icons */
export declare const Icon: React.FC<{ name: string; className?: string; size?: number | string; strokeWidth?: number | string }>
/** Every Lucide icon component, keyed by PascalCase name. */
export declare const icons: Record<string, React.FC<{ className?: string; size?: number | string }>>

/** Joins class names and resolves conflicting Tailwind classes. */
export declare function cn(...inputs: unknown[]): string

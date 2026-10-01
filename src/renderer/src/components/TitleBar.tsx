import type { ReactNode } from 'react'
import { cn, currentPlatform } from '@/lib/utils'

const platform = currentPlatform()

/**
 * Draggable title area. The OS draws the caption buttons (Windows, right) or
 * traffic lights (macOS, left) over it, so content keeps clear of them.
 */
export function TitleBar({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'drag flex h-(--titlebar-height) shrink-0 items-center gap-2',
        platform === 'darwin' ? 'ps-20 pe-3' : platform === 'win32' ? 'ps-3 pe-[140px]' : 'px-3',
        className
      )}
    >
      {children}
    </div>
  )
}

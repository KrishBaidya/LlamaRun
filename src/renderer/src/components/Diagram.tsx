import { useEffect, useId, useState, type ReactNode } from 'react'
import { RenderedBlock } from './HtmlPreview'

type Mermaid = (typeof import('mermaid'))['default']
let mermaidLoad: Promise<Mermaid> | null = null
let mermaidTheme = ''

/**
 * A theme colour as #rrggbb (Mermaid can't read the oklch() the app's CSS uses).
 * Many app colours are see-through, so they are blended over an opaque base first.
 */
function cssColor(variable: string, fallback: string, base: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  if (!value) return fallback
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx) return fallback
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 1, 1)
  ctx.fillStyle = fallback
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/** Mermaid is large, so it loads the first time a diagram shows up. Diagrams use the app's colours. */
async function loadMermaid(): Promise<Mermaid> {
  const mermaid = await (mermaidLoad ??= import('mermaid').then((m) => m.default))
  const dark = document.documentElement.classList.contains('dark')
  const base = dark ? '#202020' : '#ffffff'
  const colors = {
    background: cssColor('--background', base, base),
    card: cssColor('--muted', dark ? '#2b2b2b' : '#f4f4f5', base),
    border: cssColor('--border', dark ? '#3f3f46' : '#d4d4d8', base),
    text: cssColor('--foreground', dark ? '#fafafa' : '#18181b', base),
    muted: cssColor('--muted-foreground', dark ? '#a1a1aa' : '#71717a', base),
    accent: cssColor('--primary', '#10b981', base)
  }
  const theme = JSON.stringify(colors)
  if (theme !== mermaidTheme) {
    mermaid.initialize({
      startOnLoad: false,
      // strict: no scripts or click handlers in diagrams; labels are sanitized.
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'inherit',
      themeVariables: {
        darkMode: dark,
        background: colors.background,
        primaryColor: colors.card,
        primaryTextColor: colors.text,
        primaryBorderColor: colors.border,
        secondaryColor: colors.card,
        tertiaryColor: colors.background,
        lineColor: colors.muted,
        textColor: colors.text,
        edgeLabelBackground: colors.background,
        clusterBkg: colors.background,
        actorBkg: colors.card,
        actorBorder: colors.border,
        signalColor: colors.muted,
        signalTextColor: colors.text,
        noteBkgColor: colors.card,
        noteBorderColor: colors.accent
      }
    })
    mermaidTheme = theme
  }
  return mermaid
}

/** Waits until the text stops changing (a reply still streaming) before drawing. */
function useSettled(value: string, ms = 200): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/**
 * A ```mermaid block drawn as the diagram itself (flowcharts, sequence
 * diagrams, timelines…), like Claude does. Until the source parses (it may
 * still be streaming), the last good drawing or the code is shown.
 */
export function MermaidDiagram({ source, code }: { source: string; code: ReactNode }) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const text = useSettled(source.trim())
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const mermaid = await loadMermaid()
        if (!(await mermaid.parse(text, { suppressErrors: true }))) return
        const { svg } = await mermaid.render(id, text)
        if (!cancelled) setSvg(svg)
      } catch {
        // Keep whatever was drawn last.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, text])

  if (!svg) return <>{code}</>
  const drawing = (large: boolean) => (
    <div
      className={large ? 'flex size-full items-center justify-center [&>svg]:max-h-full [&>svg]:!max-w-full' : 'flex justify-center overflow-x-auto py-2 [&>svg]:h-auto [&>svg]:max-h-[600px] [&>svg]:max-w-full'}
      // Mermaid's own output, sanitized by its strict security level.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
  return (
    <RenderedBlock label="Diagram" source={source} code={code} large={drawing(true)}>
      {drawing(false)}
    </RenderedBlock>
  )
}

/** An SVG as a data: image, so any scripts in it never run. */
function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`
}

/** A ```svg block drawn inline rather than in a page preview. */
export function SvgImage({ svg, code }: { svg: string; code: ReactNode }) {
  const src = svgUrl(svg)
  // Without its own width an SVG would stretch to the message; use its viewBox size instead.
  const sized = /<svg[^>]*\swidth\s*=/i.test(svg)
  const viewBoxWidth = Number(/<svg[^>]*\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)/i.exec(svg)?.[1])
  const width = !sized && viewBoxWidth > 0 ? viewBoxWidth : undefined
  return (
    <RenderedBlock
      label="SVG"
      source={svg}
      code={code}
      large={<img src={src} alt="" className="max-h-full max-w-full object-contain" />}
    >
      <div className="flex justify-center">
        <img src={src} alt="" className="h-auto max-w-full" style={width ? { width } : undefined} />
      </div>
    </RenderedBlock>
  )
}

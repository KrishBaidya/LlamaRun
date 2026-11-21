import { memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { cn } from '@/lib/utils'
import { MermaidDiagram, SvgImage } from './Diagram'
import { HtmlPreview, ZoomableImage } from './HtmlPreview'
import { PluginCodeBlock } from './plugins/surfaces'

interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

/** The plain text of a hast node (code highlighting splits it into spans). */
function textOf(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

/** A fenced block's language and text. */
function codeOf(pre: HastNode | undefined): { lang: string | undefined; text: string } {
  const code = pre?.children?.find((c) => c.tagName === 'code')
  const classes = Array.isArray(code?.properties?.className) ? (code!.properties!.className as string[]) : []
  return { lang: classes.find((c) => c.startsWith('language-'))?.slice('language-'.length), text: textOf(code) }
}

/** Fenced code a model wrote to be seen: ```html, ```mermaid, or ```svg / an <svg> in ```xml. */
function previewable(pre: HastNode | undefined): { kind: 'html' | 'svg' | 'mermaid'; text: string } | null {
  const { lang, text } = codeOf(pre)
  if (lang === 'html' || lang === 'htm') return { kind: 'html', text }
  if (lang === 'mermaid') return { kind: 'mermaid', text }
  if (lang === 'svg' || ((lang === 'xml' || !lang) && /^\s*<svg[\s>]/i.test(text))) return { kind: 'svg', text }
  return null
}

const components: Components = {
  a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <ZoomableImage src={src} alt={alt} className="my-2 inline-block max-h-96 max-w-full rounded-lg border border-border/60" />
    ) : null,
  pre: ({ node, children, ...props }) => {
    const pre = <pre {...props}>{children as ReactNode}</pre>
    const preview = previewable(node as HastNode | undefined)
    if (preview?.kind === 'html') return <HtmlPreview html={preview.text} code={pre} />
    if (preview?.kind === 'mermaid') return <MermaidDiagram source={preview.text} code={pre} />
    if (preview?.kind === 'svg') return <SvgImage svg={preview.text} code={pre} />
    // A language a plugin draws (```chart), SDK 1.6.
    const { lang, text } = codeOf(node as HastNode | undefined)
    return <PluginCodeBlock language={lang} code={text} pre={pre} />
  }
}

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('markdown', className)} data-selectable>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
        // data: images are allowed so plugins and models can show pictures inline.
        urlTransform={(url) => (/^(https?:|mailto:|data:image\/)/i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : '')}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

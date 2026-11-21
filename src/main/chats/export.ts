import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import type { Chat, ChatMessage, MessagePart } from '@shared/types'

/**
 * A chat as a file to keep or share, like OpenCode's share and Claude Code's
 * export: Markdown, or one self-contained HTML page (styles and images inside,
 * nothing loaded from the web). Tool calls are listed with their results;
 * thinking is left out of Markdown and folded away in HTML.
 */

const when = (t: number): string => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const fence = (text: string): string => {
  const ticks = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)))
  return `${ticks}\n${text}\n${ticks}`
}

function partsOf(m: ChatMessage): MessagePart[] {
  return m.parts?.length ? m.parts : m.content ? [{ type: 'text', text: m.content }] : []
}

export function chatToMarkdown(chat: Chat): string {
  const out = [`# ${chat.title}`, '', `Exported from Llama Run on ${when(Date.now())}. Model: ${chat.model || 'unknown'}.`, '']
  for (const m of chat.messages) {
    if (m.role === 'user') {
      out.push(`## You`, '', m.content)
      for (const a of m.attachments ?? []) out.push('', `_Attached: ${a.name}_`)
    } else {
      out.push(`## ${m.from ? m.from.plugin : 'Llama Run'}${m.model && !m.from ? ` (${m.model})` : ''}`, '')
      for (const p of partsOf(m)) {
        if (p.type === 'text' && p.text.trim()) out.push(p.text.trim(), '')
        else if (p.type === 'steer') out.push(`> **You, while it worked:** ${p.text}`, '')
        else if (p.type === 'tool') {
          const args = p.args && Object.keys(p.args).length ? ` ${JSON.stringify(p.args)}` : ''
          out.push(`<details><summary>Tool: ${p.name}${p.status === 'error' ? ' (failed)' : ''}</summary>`, '', fence(`${p.name}${args}`), '', p.result ? fence(p.result) : '', '</details>', '')
        }
      }
      if (m.status === 'error') out.push(`_Error: ${m.error ?? 'failed'}_`, '')
      if (m.status === 'cancelled') out.push(`_${m.note ?? 'Stopped'}_`, '')
    }
    out.push('')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Markdown as HTML; raw HTML in a message is shown as text, never run. */
export const markdownHtml = (text: string): string => micromark(text, { extensions: [gfm()], htmlExtensions: [gfmHtml()] })

const STYLE = `
:root { color-scheme: light dark; --bg: #fff; --fg: #1d1d1f; --muted: #6e6e73; --card: #f5f5f7; --line: #e3e3e8; --accent: #6b4de6; }
@media (prefers-color-scheme: dark) { :root { --bg: #161618; --fg: #ececf0; --muted: #9a9aa2; --card: #222226; --line: #33333a; --accent: #a594ff; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
header h1 { font-size: 22px; margin: 0 0 4px; }
header p { color: var(--muted); margin: 0 0 24px; font-size: 13px; }
.msg { margin: 0 0 20px; }
.who { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.user .body { background: var(--card); border-radius: 16px; padding: 10px 14px; white-space: pre-wrap; margin-left: auto; max-width: 85%; width: fit-content; }
.user .who { text-align: right; }
.body img { max-width: 100%; border-radius: 10px; }
pre { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px; overflow-x: auto; font-size: 13px; }
code { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
table { border-collapse: collapse; } td, th { border: 1px solid var(--line); padding: 4px 8px; }
details { border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; margin: 8px 0; font-size: 13px; }
summary { cursor: pointer; color: var(--muted); }
.steer { border-left: 3px solid var(--accent); padding-left: 10px; color: var(--muted); }
.note { color: var(--muted); font-style: italic; }
a { color: var(--accent); }
`

function messageHtml(m: ChatMessage): string {
  if (m.role === 'user') {
    const images = (m.attachments ?? []).filter((a) => a.kind === 'image' && a.dataUrl?.startsWith('data:image/')).map((a) => `<img src="${escapeHtml(a.dataUrl!)}" alt="${escapeHtml(a.name)}">`)
    const docs = (m.attachments ?? []).filter((a) => a.kind !== 'image').map((a) => `<div class="note">Attached: ${escapeHtml(a.name)}</div>`)
    return `<section class="msg user"><div class="who">You · ${when(m.createdAt)}</div>${images.join('')}<div class="body">${escapeHtml(m.content)}</div>${docs.join('')}</section>`
  }
  const body = partsOf(m)
    .map((p) => {
      if (p.type === 'text') return p.text.trim() ? markdownHtml(p.text) : ''
      if (p.type === 'steer') return `<p class="steer">You, while it worked: ${escapeHtml(p.text)}</p>`
      if (p.type === 'thinking') return p.text.trim() ? `<details><summary>Thinking</summary>${markdownHtml(p.text)}</details>` : ''
      const args = p.args && Object.keys(p.args).length ? `<pre><code>${escapeHtml(JSON.stringify(p.args, null, 2))}</code></pre>` : ''
      return `<details><summary>Tool: ${escapeHtml(p.name)}${p.status === 'error' ? ' (failed)' : ''}</summary>${args}${p.result ? `<pre><code>${escapeHtml(p.result)}</code></pre>` : ''}</details>`
    })
    .join('')
  const note = m.status === 'error' ? `<p class="note">Error: ${escapeHtml(m.error ?? 'failed')}</p>` : m.status === 'cancelled' ? `<p class="note">${escapeHtml(m.note ?? 'Stopped')}</p>` : ''
  const who = m.from ? m.from.plugin : `Llama Run${m.model ? ` · ${m.model}` : ''}`
  return `<section class="msg"><div class="who">${escapeHtml(who)}</div><div class="body">${body}${note}</div></section>`
}

export function chatToHtml(chat: Chat): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escapeHtml(chat.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header><h1>${escapeHtml(chat.title)}</h1><p>Exported from Llama Run on ${escapeHtml(when(Date.now()))}</p></header>
${chat.messages.map(messageHtml).join('\n')}
</main>
</body>
</html>
`
}

/** A file name for the chat, safe on Windows. */
export const exportName = (chat: Chat, ext: 'md' | 'html'): string =>
  `${(chat.title || 'Chat').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Chat'}.${ext}`

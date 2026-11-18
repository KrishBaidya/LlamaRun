import { describe, expect, it } from 'vitest'
import type { Chat } from '../src/shared/types'
import { chatToHtml, chatToMarkdown, exportName } from '../src/main/chats/export'

const chat: Chat = {
  id: 'c1',
  title: 'PDF: report / draft?',
  model: 'gemini-3.8-flash',
  createdAt: 1,
  updatedAt: 1,
  messages: [
    { id: 'u1', role: 'user', content: 'Make a <b>report</b>', status: 'done', createdAt: 1, attachments: [{ id: 'a', kind: 'image', name: 'chart.png', mimeType: 'image/png', size: 3, dataUrl: 'data:image/png;base64,AAAA' }] },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Done.',
      status: 'done',
      model: 'gemini-3.8-flash',
      createdAt: 2,
      parts: [
        { type: 'thinking', text: 'secret plan' },
        { type: 'text', text: 'Writing **it** now.' },
        { type: 'tool', id: 't', name: 'write_file', server: 'Llama Run', args: { path: 'r.md' }, status: 'done', result: 'Wrote 10 bytes' },
        { type: 'steer', text: 'use A4' },
        { type: 'text', text: '| a | b |\n|---|---|\n| 1 | 2 |' }
      ]
    }
  ]
}

describe('chat export', () => {
  it('writes Markdown with tool calls but no thinking', () => {
    const md = chatToMarkdown(chat)
    expect(md).toContain('# PDF: report / draft?')
    expect(md).toContain('## You\n\nMake a <b>report</b>')
    expect(md).toContain('_Attached: chart.png_')
    expect(md).toContain('Writing **it** now.')
    expect(md).toContain('<summary>Tool: write_file</summary>')
    expect(md).toContain('> **You, while it worked:** use A4')
    expect(md).not.toContain('secret plan')
  })

  it('writes one self-contained HTML page, rendering Markdown and escaping raw HTML', () => {
    const html = chatToHtml(chat)
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('Make a &lt;b&gt;report&lt;/b&gt;')
    expect(html).toContain('<strong>it</strong>')
    expect(html).toContain('<table>')
    expect(html).toContain('<img src="data:image/png;base64,AAAA"')
    expect(html).toContain('<summary>Thinking</summary>')
    expect(html).not.toMatch(/<script|https?:\/\/[^"]*\.(js|css)/)
  })

  it('names the file safely', () => {
    expect(exportName(chat, 'md')).toBe('PDF report draft.md')
  })
})

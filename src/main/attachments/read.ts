import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import type { ChatAttachment } from '@shared/types'

/** Text kept per document; it shares the context window with the rest of the chat. */
export const MAX_DOCUMENT_CHARS = 40_000
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

const TEXT_EXTENSIONS = new Set(
  (
    'txt md markdown csv tsv json jsonl yaml yml toml ini cfg conf log xml html htm css scss js mjs cjs ts tsx jsx py ' +
    'rb go rs java kt swift c h cpp hpp cs php sh ps1 bat sql r lua dart vue svelte tex rst srt vtt env'
  ).split(' ')
)

export function isTextFile(name: string, mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    /json|xml|javascript|yaml|csv/.test(mimeType) ||
    TEXT_EXTENSIONS.has(extname(name).slice(1).toLowerCase())
  )
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = (Array.isArray(text) ? text : [text]).map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`)
  return { text: pages.join('\n\n'), pages: totalPages }
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  return value
}

/** Reads an attached document into text the model can read. Images are prepared in the renderer. */
export async function readDocument(name: string, mimeType: string, bytes: Uint8Array): Promise<ChatAttachment> {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error(`${name} is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`)
  const ext = extname(name).slice(1).toLowerCase()
  let text: string
  let pages: number | undefined
  if (ext === 'pdf' || mimeType === 'application/pdf') {
    const pdf = await pdfText(bytes)
    text = pdf.text
    pages = pdf.pages
    if (!text.replace(/--- Page \d+ ---/g, '').trim()) throw new Error(`${name} has no text layer (a scan?). Attach it as images instead.`)
  } else if (ext === 'docx') {
    text = await docxText(bytes)
  } else if (isTextFile(name, mimeType)) {
    text = new TextDecoder('utf-8').decode(bytes)
  } else {
    throw new Error(`${name}: only PDF, Word (.docx), text and code files can be read`)
  }
  text = text.replace(/\r\n/g, '\n').trim()
  const truncated = text.length > MAX_DOCUMENT_CHARS
  return {
    id: randomUUID(),
    kind: 'document',
    name,
    mimeType: mimeType || 'application/octet-stream',
    size: bytes.byteLength,
    text: truncated ? text.slice(0, MAX_DOCUMENT_CHARS) : text,
    ...(truncated ? { truncated } : {}),
    ...(pages ? { pages } : {})
  }
}

/** How a document is put in front of the model, inside the user's message. */
export function documentBlock(a: ChatAttachment): string {
  const note = a.truncated ? ' (only the beginning; the rest was cut to fit)' : ''
  return `<document name="${a.name.replace(/"/g, "'")}"${a.pages ? ` pages="${a.pages}"` : ''}>${note}\n${a.text ?? ''}\n</document>`
}

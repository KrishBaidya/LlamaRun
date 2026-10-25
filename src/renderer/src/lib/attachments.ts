import type { ChatAttachment } from '@shared/types'
import { api } from '@/hooks/use-llamarun'

/** Longest side of an image sent to a model; bigger ones cost more and gain nothing. */
const MAX_IMAGE_SIDE = 1568
/** Images at or under this size that already fit MAX_IMAGE_SIDE are sent as they are. */
const KEEP_IMAGE_BYTES = 1.5 * 1024 * 1024

export const ACCEPT =
  'image/*,.pdf,.docx,.txt,.md,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.css,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.sql,.sh,.ps1,.log,.ini,.toml'

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(blob)
  })
}

async function imageAttachment(file: File): Promise<ChatAttachment> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) throw new Error(`${file.name || 'That image'} is not an image Llama Run can read`)
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
  let dataUrl: string
  let mimeType = file.type
  if (scale === 1 && file.size <= KEEP_IMAGE_BYTES && /^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    dataUrl = await readAsDataUrl(file)
  } else {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    // PNGs keep transparency (screenshots, diagrams); everything else becomes JPEG.
    mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    dataUrl = canvas.toDataURL(mimeType, 0.88)
  }
  bitmap.close()
  return {
    id: crypto.randomUUID(),
    kind: 'image',
    name: file.name || 'Pasted image',
    mimeType,
    size: Math.round((dataUrl.length * 3) / 4),
    dataUrl
  }
}

/** Turns picked, pasted or dropped files into attachments: images here, documents in the main process. */
export async function toAttachment(file: File): Promise<ChatAttachment> {
  if (file.type.startsWith('image/')) return imageAttachment(file)
  const bytes = new Uint8Array(await file.arrayBuffer())
  return api.attachments.read(file.name, file.type, bytes)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

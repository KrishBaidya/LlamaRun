import { BASE_SERVER_URL } from '@shared/constants'

/**
 * image_generate: makes or edits an image through the Llama Run server
 * (Gemini's image model), like ChatGPT's and Codex's image generation.
 */

export const IMAGES_URL = `${BASE_SERVER_URL}/api/v1/images`

export interface GeneratedImage {
  bytes: Buffer
  mediaType: string
  /** Anything the model said with it. */
  text: string
}

export async function generateImage(prompt: string, inputs: { data: string; mediaType: string }[], token: string, signal?: AbortSignal): Promise<GeneratedImage> {
  if (!token) throw new Error('Making images needs the user to sign in to Llama Run.')
  const res = await fetch(IMAGES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt, ...(inputs.length ? { images: inputs } : {}) }),
    signal: signal ?? AbortSignal.timeout(120_000)
  })
  const data = (await res.json().catch(() => ({}))) as { images?: { data: string; mediaType: string }[]; text?: string; error?: string; code?: string }
  if (!res.ok) {
    if (res.status === 404) throw new Error('Image generation is not available on this server yet.')
    if (data.code === 'PLAN_REQUIRED') throw new Error('Making images needs the Pro plan. Tell the user they can upgrade in Settings.')
    throw new Error(data.error ? `Image generation failed: ${data.error}` : `Image generation failed (HTTP ${res.status})`)
  }
  const image = data.images?.[0]
  if (!image) throw new Error(data.text || 'No image came back.')
  return { bytes: Buffer.from(image.data, 'base64'), mediaType: image.mediaType, text: data.text ?? '' }
}

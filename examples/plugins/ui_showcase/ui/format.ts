// Panels can import their own files, just not packages other than react and @llamarun/*.
export function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Incremental parser for a stream of concatenated JSON objects
 * (`{"a":1}{"b":2}` possibly split across chunks at arbitrary points),
 * which is what the LlamaRun backend's /api/llm/generate endpoint sends.
 */
export class JsonObjectStreamParser {
  private buf = ''
  private depth = 0
  private inString = false
  private escaped = false
  private start = -1
  private scanned = 0

  push(chunk: string): unknown[] {
    this.buf += chunk
    const out: unknown[] = []
    for (let i = this.scanned; i < this.buf.length; i++) {
      const ch = this.buf[i]
      if (this.inString) {
        if (this.escaped) this.escaped = false
        else if (ch === '\\') this.escaped = true
        else if (ch === '"') this.inString = false
        continue
      }
      if (ch === '"') this.inString = true
      else if (ch === '{' || ch === '[') {
        if (this.depth === 0) this.start = i
        this.depth++
      } else if (ch === '}' || ch === ']') {
        this.depth--
        if (this.depth === 0 && this.start >= 0) {
          out.push(JSON.parse(this.buf.slice(this.start, i + 1)))
          this.start = -1
        }
      }
    }
    if (this.depth === 0) {
      this.buf = ''
      this.scanned = 0
    } else {
      // Keep only the unfinished object.
      this.buf = this.buf.slice(this.start)
      this.scanned = this.buf.length
      this.start = 0
    }
    return out
  }
}

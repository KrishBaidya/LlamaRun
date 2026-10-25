/**
 * Reads the `---` front matter of a SKILL.md: plain `key: value` lines, quoted
 * values and `>` / `|` blocks, which is all skills use for name and description.
 */
export function parseFrontMatter(text: string): { data: Record<string, string>; body: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!match) return { data: {}, body: text }
  const data: Record<string, string> = {}
  const lines = match[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i])
    if (!m) continue
    let value = m[2].trim()
    if (/^[>|][-+]?$/.test(value)) {
      const block: string[] = []
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim())
      value = value.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim()
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1)
    }
    data[m[1]] = value
  }
  return { data, body: text.slice(match[0].length) }
}

import type { PluginAttachmentFile, PluginButtonPlace, PluginSurfaces, UiNode } from '@shared/types'

/**
 * What running plugins added to the chat window and Settings (SDK 1.6): code
 * block renderers, buttons, tool cards, status items, Settings pages and
 * attach-menu entries. Plain data, checked here; the host checks permissions
 * and talks to the plugins.
 */

/** Languages the chat window already draws itself. */
const BUILTIN_LANGUAGES = new Set(['html', 'htm', 'mermaid', 'svg', 'xml'])
const LANGUAGE = /^[a-z][a-z0-9_+-]{0,31}$/
const ID = /^[A-Za-z0-9_.:-]{1,64}$/
const PLACES: PluginButtonPlace[] = ['message', 'composer', 'sidebar']
const MAX_PER_KIND = 20
const ICON = /^[A-Za-z][A-Za-z0-9-]{0,47}$/

export const MAX_HTML_CHARS = 2_000_000
export const MAX_ATTACHMENTS = 10
/** Per file, base64 or text. */
export const MAX_ATTACHMENT_CHARS = 20_000_000

interface PluginEntries {
  renderers: Map<string, { label: string }>
  buttons: Map<string, { where: PluginButtonPlace; label: string; icon?: string; tooltip?: string }>
  statusItems: Map<string, { text: string; icon?: string; tooltip?: string; clickable: boolean }>
  attachSources: Map<string, { label: string; icon?: string }>
  pages: Map<string, { title: string; icon?: string; tree: UiNode | null }>
  toolCards: Set<string>
}

const text = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max)
const optional = (v: unknown, max: number): string | undefined => text(v, max) || undefined
function icon(v: unknown): string | undefined {
  const name = text(v, 48)
  return ICON.test(name) ? name : undefined
}
function id(v: unknown, what: string): string {
  const value = String(v ?? '')
  if (!ID.test(value)) throw new Error(`"${value}" is not a valid ${what} id. Use up to 64 letters, digits, _ . : or -.`)
  return value
}

export class SurfaceRegistry {
  private plugins = new Map<string, PluginEntries>()

  private of(plugin: string): PluginEntries {
    let entries = this.plugins.get(plugin)
    if (!entries) {
      entries = { renderers: new Map(), buttons: new Map(), statusItems: new Map(), attachSources: new Map(), pages: new Map(), toolCards: new Set() }
      this.plugins.set(plugin, entries)
    }
    return entries
  }

  private room(map: Map<string, unknown> | Set<string>, key: string, what: string): void {
    if (!map.has(key) && map.size >= MAX_PER_KIND) throw new Error(`A plugin can add up to ${MAX_PER_KIND} ${what}`)
  }

  /** Drops everything a plugin added (it stopped). True when it had added anything. */
  forget(plugin: string): boolean {
    const e = this.plugins.get(plugin)
    this.plugins.delete(plugin)
    return !!e && (e.renderers.size + e.buttons.size + e.statusItems.size + e.attachSources.size + e.pages.size + e.toolCards.size > 0)
  }

  // ------------------------------------------------------------ renderers

  addRenderer(plugin: string, p: Record<string, unknown>, nameOf: (plugin: string) => string): string {
    const language = String(p.language ?? '').trim().toLowerCase()
    if (!LANGUAGE.test(language)) throw new Error(`"${language}" is not a valid code block language. Use lowercase letters, digits, _ + and -.`)
    if (BUILTIN_LANGUAGES.has(language)) throw new Error(`Llama Run draws \`\`\`${language} blocks itself`)
    const other = this.rendererFor(language)
    if (other && other !== plugin) throw new Error(`\`\`\`${language} blocks are already drawn by ${nameOf(other)}`)
    const entries = this.of(plugin)
    this.room(entries.renderers, language, 'code block renderers')
    entries.renderers.set(language, { label: text(p.label, 40) || language })
    return language
  }

  removeRenderer(plugin: string, language: unknown): boolean {
    return this.plugins.get(plugin)?.renderers.delete(String(language ?? '').toLowerCase()) ?? false
  }

  /** The plugin that draws a language, if any. */
  rendererFor(language: string): string | null {
    for (const [plugin, e] of this.plugins) if (e.renderers.has(language)) return plugin
    return null
  }

  // -------------------------------------------------------------- buttons

  addButton(plugin: string, p: Record<string, unknown>): string {
    const key = id(p.id, 'button')
    const where = String(p.where ?? '') as PluginButtonPlace
    if (!PLACES.includes(where)) throw new Error(`A button goes on "message", "composer" or "sidebar", not "${where}"`)
    const label = text(p.label, 40)
    if (!label) throw new Error('A button needs a label')
    const entries = this.of(plugin)
    this.room(entries.buttons, key, 'buttons')
    entries.buttons.set(key, { where, label, icon: icon(p.icon), tooltip: optional(p.tooltip, 200) })
    return key
  }

  removeButton(plugin: string, key: unknown): boolean {
    return this.plugins.get(plugin)?.buttons.delete(String(key ?? '')) ?? false
  }

  hasButton(plugin: string, key: string): boolean {
    return this.plugins.get(plugin)?.buttons.has(key) ?? false
  }

  // ------------------------------------------------------------ tool cards

  addToolCard(plugin: string, tool: unknown): string {
    const name = String(tool ?? '')
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error(`"${name}" is not a tool name`)
    const entries = this.of(plugin)
    this.room(entries.toolCards, name, 'tool cards')
    entries.toolCards.add(name)
    return name
  }

  removeToolCard(plugin: string, tool: unknown): boolean {
    return this.plugins.get(plugin)?.toolCards.delete(String(tool ?? '')) ?? false
  }

  hasToolCard(plugin: string, tool: string): boolean {
    return this.plugins.get(plugin)?.toolCards.has(tool) ?? false
  }

  // ---------------------------------------------------------- status items

  setStatusItem(plugin: string, p: Record<string, unknown>): string {
    const key = id(p.id, 'status item')
    const entries = this.of(plugin)
    this.room(entries.statusItems, key, 'status items')
    const item = { text: text(p.text, 60), icon: icon(p.icon), tooltip: optional(p.tooltip, 300), clickable: p.clickable === true }
    if (!item.text && !item.icon) throw new Error('A status item needs text or an icon')
    entries.statusItems.set(key, item)
    return key
  }

  removeStatusItem(plugin: string, key: unknown): boolean {
    return this.plugins.get(plugin)?.statusItems.delete(String(key ?? '')) ?? false
  }

  isClickable(plugin: string, key: string): boolean {
    return this.plugins.get(plugin)?.statusItems.get(key)?.clickable ?? false
  }

  // ------------------------------------------------------- attach sources

  addAttachSource(plugin: string, p: Record<string, unknown>): string {
    const key = id(p.id, 'attachment source')
    const label = text(p.label, 60)
    if (!label) throw new Error('An attachment source needs a label')
    const entries = this.of(plugin)
    this.room(entries.attachSources, key, 'attachment sources')
    entries.attachSources.set(key, { label, icon: icon(p.icon) })
    return key
  }

  removeAttachSource(plugin: string, key: unknown): boolean {
    return this.plugins.get(plugin)?.attachSources.delete(String(key ?? '')) ?? false
  }

  hasAttachSource(plugin: string, key: string): boolean {
    return this.plugins.get(plugin)?.attachSources.has(key) ?? false
  }

  // ------------------------------------------------------------- pages

  addPage(plugin: string, p: Record<string, unknown>): string {
    const key = id(p.id, 'page')
    const title = text(p.title, 60)
    if (!title) throw new Error('A Settings page needs a title')
    const entries = this.of(plugin)
    this.room(entries.pages, key, 'Settings pages')
    entries.pages.set(key, { title, icon: icon(p.icon), tree: (p.tree as UiNode | undefined) ?? null })
    return key
  }

  removePage(plugin: string, key: unknown): boolean {
    return this.plugins.get(plugin)?.pages.delete(String(key ?? '')) ?? false
  }

  /** A new tree for a page; false when `key` is not one of the plugin's pages (it's a panel). */
  renderPage(plugin: string, key: string, tree: UiNode): boolean {
    const page = this.plugins.get(plugin)?.pages.get(key)
    if (!page) return false
    page.tree = tree
    return true
  }

  pageTree(plugin: string, key: string): UiNode | null {
    return this.plugins.get(plugin)?.pages.get(key)?.tree ?? null
  }

  hasPage(plugin: string, key: string): boolean {
    return this.plugins.get(plugin)?.pages.has(key) ?? false
  }

  // ------------------------------------------------------------ snapshot

  /**
   * Everything, for the windows, in plugin load order. `server` names the
   * plugin as its tools' calls do; `live` leaves out plugins that are not running.
   */
  snapshot(order: string[], nameOf: (plugin: string) => string, live: (plugin: string) => boolean = () => true): PluginSurfaces {
    const out: PluginSurfaces = { renderers: [], buttons: [], statusItems: [], attachSources: [], settingsPages: [], toolCards: [] }
    const each = <T>(map: Map<string, T>): (T & { id: string })[] => [...map].map(([key, value]) => ({ ...value, id: key }))
    for (const plugin of order) {
      const e = this.plugins.get(plugin)
      if (!e || !live(plugin)) continue
      const pluginName = nameOf(plugin)
      const who = { plugin, pluginName }
      for (const [language, r] of e.renderers) out.renderers.push({ ...who, language, label: r.label })
      for (const b of each(e.buttons)) out.buttons.push({ ...who, ...b })
      for (const s of each(e.statusItems)) out.statusItems.push({ ...who, ...s })
      for (const a of each(e.attachSources)) out.attachSources.push({ ...who, ...a })
      for (const [key, page] of e.pages) out.settingsPages.push({ ...who, id: key, title: page.title, icon: page.icon })
      for (const tool of e.toolCards) out.toolCards.push({ plugin, server: pluginName, tool })
    }
    return out
  }
}

/** The HTML a renderer or tool card returned, or null for none. */
export function renderedHtml(value: unknown): string | null {
  const html = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as { html?: unknown }).html : null
  if (typeof html !== 'string' || !html.trim()) return null
  if (html.length > MAX_HTML_CHARS) throw new Error('The plugin drew a page that is too large')
  return html
}

/** Files an attachment source handed back, checked. */
export function attachmentFiles(value: unknown): PluginAttachmentFile[] {
  const list = Array.isArray(value) ? value : value ? [value] : []
  if (list.length > MAX_ATTACHMENTS) throw new Error(`Attach up to ${MAX_ATTACHMENTS} files at a time`)
  return list.map((raw, i) => {
    const item = (raw ?? {}) as Record<string, unknown>
    const name = text(item.name, 200).replace(/[\\/:*?"<>|]/g, '_') || `attachment-${i + 1}`
    const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(String(item.mime_type ?? item.mimeType ?? '')) ? String(item.mime_type ?? item.mimeType) : ''
    if (typeof item.text === 'string') {
      if (item.text.length > MAX_ATTACHMENT_CHARS) throw new Error(`${name} is too large to attach`)
      return { name, mimeType: mimeType || 'text/plain', text: item.text }
    }
    if (typeof item.data === 'string') {
      if (item.data.length > MAX_ATTACHMENT_CHARS) throw new Error(`${name} is too large to attach`)
      if (!/^[A-Za-z0-9+/=\s]*$/.test(item.data)) throw new Error(`${name}: "data" must be base64`)
      return { name, mimeType: mimeType || 'application/octet-stream', data: item.data.replace(/\s+/g, '') }
    }
    throw new Error(`${name}: give an attachment "text" or base64 "data"`)
  })
}

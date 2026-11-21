import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.', getVersion: () => '0' } }))
const { SurfaceRegistry, renderedHtml, attachmentFiles, MAX_ATTACHMENTS } = await import('../src/main/plugins/surfaces')
const { PERMISSIONS } = await import('../src/main/plugins/permissions')
const { SDK_VERSION, validateManifest } = await import('../src/main/plugins/manifest')

const names: Record<string, string> = { a: 'Alpha', b: 'Beta' }
const nameOf = (id: string): string => names[id] ?? id

describe('plugin SDK 1.6 permissions', () => {
  it('adds an enforced permission for each new surface', () => {
    expect(SDK_VERSION).toBe('1.6')
    for (const id of ['renderers', 'buttons', 'statusbar', 'pages', 'attachments'] as const) {
      expect(PERMISSIONS[id]).toMatchObject({ id, enforced: true })
    }
    const m = validateManifest({
      name: 'P',
      description: 'd',
      version: '1.0.0',
      author: 'a',
      sdk_version: '1.6',
      entry: { module: 'mod_p', class: 'P' },
      permissions: ['renderers', 'buttons', 'statusbar', 'pages', 'attachments', 'tools']
    })
    expect(m.permissions).toContain('attachments')
  })
})

describe('code block renderers', () => {
  it('claims a language for one plugin, never a built-in one', () => {
    const r = new SurfaceRegistry()
    expect(r.addRenderer('a', { language: 'Chart', label: 'Chart' }, nameOf)).toBe('chart')
    expect(r.rendererFor('chart')).toBe('a')
    expect(() => r.addRenderer('b', { language: 'chart' }, nameOf)).toThrow(/already drawn by Alpha/)
    expect(() => r.addRenderer('a', { language: 'html' }, nameOf)).toThrow(/draws ```html blocks itself/)
    expect(() => r.addRenderer('a', { language: 'mermaid' }, nameOf)).toThrow(/itself/)
    expect(() => r.addRenderer('a', { language: 'two words' }, nameOf)).toThrow(/not a valid code block language/)
    expect(r.addRenderer('a', { language: 'chart', label: 'Graph' }, nameOf)).toBe('chart') // re-adding replaces
    expect(r.snapshot(['a'], nameOf).renderers).toEqual([{ plugin: 'a', pluginName: 'Alpha', language: 'chart', label: 'Graph' }])
    expect(r.removeRenderer('a', 'CHART')).toBe(true)
    expect(r.rendererFor('chart')).toBeNull()
  })
})

describe('buttons, status items, attach sources and pages', () => {
  it('validates and lists them in load order, leaving out stopped plugins', () => {
    const r = new SurfaceRegistry()
    r.addButton('b', { id: 'x', where: 'sidebar', label: 'Beta button' })
    r.addButton('a', { id: 'tr', where: 'message', label: 'Translate', icon: 'languages', tooltip: 'Translate this' })
    r.addButton('a', { id: 'bad-icon', where: 'composer', label: 'Odd', icon: '<svg>' })
    expect(() => r.addButton('a', { id: 'y', where: 'titlebar', label: 'Nope' })).toThrow(/"message", "composer" or "sidebar"/)
    expect(() => r.addButton('a', { id: 'y', where: 'message', label: '  ' })).toThrow(/needs a label/)
    expect(() => r.addButton('a', { id: 'has space', where: 'message', label: 'L' })).toThrow(/not a valid button id/)

    r.setStatusItem('a', { id: 'sync', text: 'Synced', icon: 'check', clickable: true })
    expect(() => r.setStatusItem('a', { id: 'empty', text: '' })).toThrow(/text or an icon/)
    r.addAttachSource('a', { id: 'notes', label: 'Notes', icon: 'notebook' })
    r.addPage('a', { id: 'accounts', title: 'Accounts', tree: { type: 'Text', props: { text: 'hi' } } })
    r.addToolCard('a', 'forecast')

    const snap = r.snapshot(['a', 'b'], nameOf)
    expect(snap.buttons.map((b) => b.id)).toEqual(['tr', 'bad-icon', 'x'])
    expect(snap.buttons[0]).toEqual({ plugin: 'a', pluginName: 'Alpha', id: 'tr', where: 'message', label: 'Translate', icon: 'languages', tooltip: 'Translate this' })
    expect(snap.buttons[1].icon).toBeUndefined()
    expect(snap.statusItems).toEqual([{ plugin: 'a', pluginName: 'Alpha', id: 'sync', text: 'Synced', icon: 'check', tooltip: undefined, clickable: true }])
    expect(snap.attachSources[0]).toMatchObject({ id: 'notes', label: 'Notes', icon: 'notebook' })
    expect(snap.settingsPages).toEqual([{ plugin: 'a', pluginName: 'Alpha', id: 'accounts', title: 'Accounts', icon: undefined }])
    expect(snap.toolCards).toEqual([{ plugin: 'a', server: 'Alpha', tool: 'forecast' }])
    expect(r.snapshot(['a', 'b'], nameOf, (id) => id === 'b').buttons.map((b) => b.id)).toEqual(['x'])

    expect(r.isClickable('a', 'sync')).toBe(true)
    expect(r.hasButton('a', 'x')).toBe(false) // another plugin's
    expect(r.hasAttachSource('a', 'notes') && r.hasPage('a', 'accounts') && r.hasToolCard('a', 'forecast')).toBe(true)
    expect(r.forget('a')).toBe(true)
    expect(r.forget('a')).toBe(false)
    expect(r.snapshot(['a', 'b'], nameOf).statusItems).toEqual([])
  })

  it('routes renders to pages and leaves panels alone', () => {
    const r = new SurfaceRegistry()
    r.addPage('a', { id: 'p', title: 'P' })
    expect(r.pageTree('a', 'p')).toBeNull()
    expect(r.renderPage('a', 'p', { type: 'Text', props: { text: 'new' } })).toBe(true)
    expect(r.pageTree('a', 'p')).toEqual({ type: 'Text', props: { text: 'new' } })
    expect(r.renderPage('a', 'panel-1', { type: 'Text', props: {} })).toBe(false)
    expect(r.renderPage('b', 'p', { type: 'Text', props: {} })).toBe(false)
  })

  it('caps how many of each a plugin adds', () => {
    const r = new SurfaceRegistry()
    for (let i = 0; i < 20; i++) r.addButton('a', { id: `b${i}`, where: 'message', label: 'L' })
    expect(() => r.addButton('a', { id: 'b20', where: 'message', label: 'L' })).toThrow(/up to 20 buttons/)
    expect(() => r.addButton('a', { id: 'b0', where: 'sidebar', label: 'Moved' })).not.toThrow()
  })
})

describe('what plugins hand back', () => {
  it('accepts HTML as a string or {html}', () => {
    expect(renderedHtml('<b>x</b>')).toBe('<b>x</b>')
    expect(renderedHtml({ html: '<i>y</i>' })).toBe('<i>y</i>')
    expect(renderedHtml(null)).toBeNull()
    expect(renderedHtml('   ')).toBeNull()
    expect(() => renderedHtml('x'.repeat(2_000_001))).toThrow(/too large/)
  })

  it('checks attachment files', () => {
    expect(attachmentFiles([{ name: 'a/b.md', mime_type: 'text/markdown', text: '# hi' }, { name: 'p.pdf', mime_type: 'application/pdf', data: 'JVBE\nRi0=' }])).toEqual([
      { name: 'a_b.md', mimeType: 'text/markdown', text: '# hi' },
      { name: 'p.pdf', mimeType: 'application/pdf', data: 'JVBERi0=' }
    ])
    expect(attachmentFiles(null)).toEqual([])
    expect(attachmentFiles({ text: 'solo' })).toEqual([{ name: 'attachment-1', mimeType: 'text/plain', text: 'solo' }])
    expect(() => attachmentFiles([{ name: 'x' }])).toThrow(/"text" or base64 "data"/)
    expect(() => attachmentFiles([{ name: 'x', data: 'not base64!' }])).toThrow(/base64/)
    expect(() => attachmentFiles(Array.from({ length: MAX_ATTACHMENTS + 1 }, () => ({ text: 'a' })))).toThrow(/up to 10/)
  })
})

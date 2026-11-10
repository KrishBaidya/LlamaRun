import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, session, type NativeImage } from 'electron'

/**
 * HTML to PDF or PNG with the Chromium Llama Run already ships: how a browser
 * prints a page, without Python or another program. Pages render in a hidden,
 * sandboxed window with its own in-memory session: no Node, no navigation,
 * network GETs only (as web_fetch), and local files only from the folders the
 * caller names, so a page can't pull in files read_file would ask about.
 */

const PARTITION = 'llamarun-render'
/** A4 at 150 dpi: the window a page lays out in before it prints. */
const PAGE_WIDTH = 1240
const PAGE_HEIGHT = 1754
/** Width a PNG is captured at unless the caller says otherwise. */
const PNG_WIDTH = 1200
/** Tallest PNG captured: longer pages are cut there. */
const MAX_PNG_HEIGHT = 10_000
const LOAD_TIMEOUT_MS = 20_000

/** webContents id -> folders its page may load files from. */
const roots = new Map<number, string[]>()
let sessionReady = false

const inside = (path: string, folder: string): boolean => {
  const rel = relative(folder, path)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

export function allowedRequest(url: string, method: string, folders: string[]): boolean {
  if (/^(data|blob|about):/i.test(url)) return true
  if (/^file:/i.test(url)) {
    try {
      const path = fileURLToPath(url)
      return folders.some((folder) => inside(path, folder))
    } catch {
      return false
    }
  }
  return /^https?:/i.test(url) && method === 'GET'
}

function renderSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION)
  if (!sessionReady) {
    sessionReady = true
    ses.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !allowedRequest(details.url, details.method, roots.get(details.webContentsId ?? -1) ?? []) })
    })
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  }
  return ses
}

export interface RenderSource {
  /** The markup itself; relative URLs in it load from `base`. */
  html?: string
  /** Or an HTML file; relative URLs load from its folder. */
  file?: string
  /** Folder relative URLs in `html` resolve against. */
  base: string
  /** Folders the page may load local files from (images, fonts, CSS), besides its own. */
  folders: string[]
}

export type RenderOutput = { kind: 'pdf'; bytes: Buffer; pages: number } | { kind: 'png'; image: NativeImage; cut: boolean }

/** Renders a page and prints it to PDF, or captures it whole as an image `width` pixels wide. */
export async function renderHtml(source: RenderSource, kind: 'pdf' | 'png', width = PNG_WIDTH): Promise<RenderOutput> {
  // Markup goes into a file next to what it links to, so its relative paths work.
  const temp = source.html !== undefined ? join(source.base, `.render-${randomUUID()}.html`) : undefined
  if (temp) writeFileSync(temp, source.html ?? '', 'utf8')
  const file = temp ?? source.file!
  const win = new BrowserWindow({
    show: false,
    width: kind === 'pdf' ? PAGE_WIDTH : width,
    height: PAGE_HEIGHT,
    webPreferences: { session: renderSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false }
  })
  const id = win.webContents.id
  roots.set(id, [dirname(file), ...source.folders])
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  try {
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      win.loadFile(file),
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`The page took longer than ${LOAD_TIMEOUT_MS / 1000} seconds to load`)), LOAD_TIMEOUT_MS)))
    ]).finally(() => clearTimeout(timer))
    // Web fonts finish after the load event; print once they're in.
    await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true', true).catch(() => undefined)
    if (kind === 'pdf') {
      // The page's own @page size and margins win; A4 otherwise.
      const bytes = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4' })
      return { kind, bytes, pages: (bytes.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length || 1 }
    }
    const height = Number(await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)', true)) || PAGE_HEIGHT
    win.setContentSize(width, Math.min(height, MAX_PNG_HEIGHT))
    await new Promise((done) => setTimeout(done, 150))
    return { kind, image: await win.webContents.capturePage(), cut: height > MAX_PNG_HEIGHT }
  } finally {
    roots.delete(id)
    win.destroy()
    if (temp) rmSync(temp, { force: true })
  }
}

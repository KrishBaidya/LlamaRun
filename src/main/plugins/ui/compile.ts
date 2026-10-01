import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import themeCss from '../../../renderer/src/theme-inline.css?raw'

/** Modules a panel may import; the panel page provides them as globals. */
export const PANEL_MODULES = ['react', 'react/jsx-runtime', 'react-dom', '@llamarun/ui', '@llamarun/plugin'] as const

export interface CompiledPanel {
  js: string
  css: string
}

export class PanelCompileError extends Error {}

type Esbuild = typeof import('esbuild-wasm')
let esbuild: Promise<Esbuild> | null = null
const require_ = createRequire(__filename)

function loadEsbuild(): Promise<Esbuild> {
  esbuild ??= (async () => {
    const mod = (await import('esbuild-wasm')) as Partial<Esbuild> & { default?: Esbuild }
    const api = (typeof mod.build === 'function' ? mod : mod.default!) as Esbuild
    await api.initialize({})
    return api
  })()
  return esbuild
}

function inside(folder: string, file: string): boolean {
  const rel = relative(folder, file)
  return !!rel && !rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel)
}

/** Bundles one TSX panel. Only files in the plugin folder and PANEL_MODULES can be imported. */
async function bundle(folder: string, entry: string): Promise<{ js: string; sources: string[] }> {
  const api = await loadEsbuild()
  const sources: string[] = []
  const result = await api
    .build({
      entryPoints: [entry],
      absWorkingDir: folder,
      bundle: true,
      write: false,
      format: 'iife',
      globalName: '__llamarunPanel',
      platform: 'browser',
      target: 'chrome130',
      jsx: 'automatic',
      minify: false,
      sourcemap: 'inline',
      logLevel: 'silent',
      loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.json': 'json' },
      plugins: [
        {
          name: 'llamarun-panel',
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if ((PANEL_MODULES as readonly string[]).includes(args.path)) {
                return { path: args.path, namespace: 'llamarun-global' }
              }
              if (!args.path.startsWith('.') && !args.path.startsWith('/') && args.kind !== 'entry-point') {
                return {
                  errors: [
                    {
                      text: `"${args.path}" can't be imported in a Llama Run panel. Panels can import react, @llamarun/ui, @llamarun/plugin and files in the plugin folder.`
                    }
                  ]
                }
              }
              return undefined
            })
            build.onLoad({ filter: /.*/, namespace: 'llamarun-global' }, (args) => ({
              contents: `module.exports = window.__llamarun[${JSON.stringify(args.path)}]`,
              loader: 'js'
            }))
            build.onLoad({ filter: /.*/ }, (args) => {
              if (!inside(folder, args.path)) {
                return { errors: [{ text: `panels can only import files inside the plugin folder (${args.path})` }] }
              }
              sources.push(args.path)
              return undefined
            })
          }
        }
      ]
    })
    .catch((err: { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }) => {
      const first = err.errors?.[0]
      const where = first?.location ? `${first.location.file}:${first.location.line}:${first.location.column}: ` : ''
      throw new PanelCompileError(`${where}${first?.text ?? String(err)}`)
    })
  return { js: result.outputFiles[0].text, sources }
}

/** Tailwind classes that exist in the plugin's source, generated against the app's theme. */
async function utilities(sources: string[]): Promise<string> {
  const candidates = new Set<string>()
  for (const file of sources) {
    for (const token of readFileSync(file, 'utf8').split(/[\s"'`{}()<>;,=]+/)) {
      if (token && token.length < 120 && /^[!-]?[a-z@[]/.test(token)) candidates.add(token)
    }
  }
  const { compile } = (await import('tailwindcss')) as typeof import('tailwindcss')
  const load = async (id: string, base: string): Promise<{ path: string; base: string; content: string }> => {
    const file = id.startsWith('.') ? resolve(base, id) : require_.resolve(id.endsWith('.css') ? id : `${id}.css`)
    return { path: file, base: dirname(file), content: readFileSync(file, 'utf8') }
  }
  const compiler = await compile(
    `@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities);\n${themeCss}`,
    { base: __dirname, loadStylesheet: load }
  )
  return compiler.build([...candidates])
}

/**
 * Compiles `entry` (relative to the plugin folder) and caches the result in
 * `cacheDir`, keyed by the content of every file it imports.
 */
export async function compilePanel(folder: string, entry: string, cacheDir: string): Promise<CompiledPanel> {
  const entryPath = resolve(folder, entry)
  if (!inside(folder, entryPath)) throw new PanelCompileError(`panel file ${entry} is outside the plugin folder`)
  if (!existsSync(entryPath)) throw new PanelCompileError(`panel file ${entry} not found`)

  const safe = entry.replace(/[^A-Za-z0-9_.-]/g, '_')
  const manifestPath = join(cacheDir, `${safe}.sources.json`)
  if (existsSync(manifestPath)) {
    try {
      const cached = JSON.parse(readFileSync(manifestPath, 'utf8')) as { key: string; sources: string[] }
      if (cached.key === cacheKey(cached.sources)) {
        return {
          js: readFileSync(join(cacheDir, `${safe}.js`), 'utf8'),
          css: readFileSync(join(cacheDir, `${safe}.css`), 'utf8')
        }
      }
    } catch {
      // stale or corrupt cache: rebuild
    }
  }

  const { js, sources } = await bundle(folder, entryPath)
  const css = await utilities(sources)
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(join(cacheDir, `${safe}.js`), js)
  writeFileSync(join(cacheDir, `${safe}.css`), css)
  writeFileSync(manifestPath, JSON.stringify({ key: cacheKey(sources), sources }))
  return { js, css }
}

function cacheKey(sources: string[]): string {
  const hash = createHash('sha256')
  for (const file of sources) {
    hash.update(file)
    try {
      hash.update(String(statSync(file).mtimeMs))
      hash.update(readFileSync(file))
    } catch {
      hash.update('missing')
    }
  }
  return hash.digest('hex')
}

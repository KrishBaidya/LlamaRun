// Downloads a relocatable CPython build (astral-sh/python-build-standalone) into
// resources/python/<os>-<arch>/ (os = win | mac | linux, matching electron-builder's ${os}) so LlamaRun ships its own interpreter.
//
//   node scripts/fetch-python.mjs [--platform win32|darwin|linux] [--arch x64|arm64] [--force]
//
// Set LLAMARUN_SKIP_PYTHON=1 to skip (e.g. when installing only for linting).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import * as tar from 'tar'

const RELEASE = '20260924'
const VERSION = '3.13.15'
const ASSETS = {
  'win32-x64': ['x86_64-pc-windows-msvc', 'cc5e5a61adbe02ae93e01a90c4b0718cc119d86cb6fa855441ff5c606b6dd6f4'],
  'win32-arm64': ['aarch64-pc-windows-msvc', '7299105677eb0833e20badb56ee07c9b79c2184b071b06a132ab02a5ff64852a'],
  'darwin-x64': ['x86_64-apple-darwin', 'f445e867ad221c006af745bc0e8d2c168149e14fe194abef1d7ac0da9a4c9de1'],
  'darwin-arm64': ['aarch64-apple-darwin', 'a18e1d1b6067d39cf7b2b605fdb78ad6b8a3aed221c44ef934d399dccf355453'],
  'linux-x64': ['x86_64-unknown-linux-gnu', 'c20e1ff8600a0241849588b36948942eaccdc80da34df69674f3784a687197de'],
  'linux-arm64': ['aarch64-unknown-linux-gnu', 'c8dd48f5e5be632b518a79076189419cb8591559959ec137e4d30f5ce143c04d']
}

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const platform = arg('platform', process.platform)
const arch = arg('arch', process.arch)
const force = args.includes('--force')

if (process.env.LLAMARUN_SKIP_PYTHON === '1') {
  console.log('[fetch-python] skipped (LLAMARUN_SKIP_PYTHON=1)')
  process.exit(0)
}

const key = `${platform}-${arch}`
const asset = ASSETS[key]
if (!asset) {
  console.warn(`[fetch-python] no bundled Python for ${key}; plugins will need LLAMARUN_PYTHON`)
  process.exit(0)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dirName = `${{ win32: 'win', darwin: 'mac' }[platform] ?? platform}-${arch}`
const dest = join(root, 'resources', 'python', dirName)
const stamp = join(dest, '.llamarun-python')
const wanted = `${VERSION}+${RELEASE}`

if (!force && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === wanted) {
  console.log(`[fetch-python] CPython ${wanted} already present in ${dest}`)
  process.exit(0)
}

const [triple, sha256] = asset
const file = `cpython-${VERSION}+${RELEASE}-${triple}-install_only.tar.gz`
const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE}/${encodeURIComponent(file)}`
const cacheDir = join(root, 'node_modules', '.cache', 'llamarun-python')
const archive = join(cacheDir, file)
mkdirSync(cacheDir, { recursive: true })

async function sha256Of(path) {
  const hash = createHash('sha256')
  const { createReadStream } = await import('node:fs')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

if (!existsSync(archive) || (await sha256Of(archive)) !== sha256) {
  console.log(`[fetch-python] downloading ${file}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status} for ${url}`)
  const { createWriteStream } = await import('node:fs')
  await pipeline(Readable.fromWeb(res.body), createWriteStream(archive))
  const actual = await sha256Of(archive)
  if (actual !== sha256) {
    rmSync(archive, { force: true })
    throw new Error(`checksum mismatch for ${file}: expected ${sha256}, got ${actual}`)
  }
}

console.log(`[fetch-python] extracting to ${dest}`)
rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
// Archives contain a single top-level "python/" directory.
await tar.x({ file: archive, cwd: dest, strip: 1 })
writeFileSync(stamp, wanted)
console.log(`[fetch-python] CPython ${wanted} ready`)

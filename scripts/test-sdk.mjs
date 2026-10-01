// Runs the Python SDK test-suite with the bundled interpreter. pytest is
// installed into node_modules/.cache (not into the bundled Python) so it
// never ships with the app.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'resources', 'python', `${{ win32: 'win', darwin: 'mac' }[process.platform] ?? process.platform}-${process.arch}`)
const python =
  process.env.LLAMARUN_PYTHON ??
  (process.platform === 'win32' ? join(dir, 'python.exe') : join(dir, 'bin', 'python3'))
if (!existsSync(python)) {
  console.error(`Bundled Python not found at ${python}. Run "npm run fetch-python" first.`)
  process.exit(1)
}

const deps = join(root, 'node_modules', '.cache', 'llamarun-pytest')
const run = (args, env = {}) =>
  spawnSync(python, args, { stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1

if (!existsSync(join(deps, 'pytest'))) {
  const status = run(['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--target', deps, 'pytest'])
  if (status !== 0) process.exit(status)
}
process.exit(
  run(['-m', 'pytest', join(root, 'sdk', 'python', 'tests'), '-q', '-p', 'no:cacheprovider', ...process.argv.slice(2)], {
    PYTHONPATH: deps,
    PYTHONDONTWRITEBYTECODE: '1'
  })
)

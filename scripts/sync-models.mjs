// Refreshes the bundled cloud model catalog (src/main/llm/models.snapshot.json) from the
// backend. The app uses the snapshot only when it can't reach the server and has no
// cached copy, so run this before a release:
//
//   npm run sync-models
//   LLAMARUN_SERVER_URL=http://localhost:3000 npm run sync-models
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'src', 'main', 'llm', 'models.snapshot.json')
const server = (process.env.LLAMARUN_SERVER_URL || 'https://llamarun.krishbaidya.me').replace(/\/+$/, '')
const url = `${server}/api/v1/models?includeDev=1`

const PROVIDERS = new Set(['gemini', 'openai'])
const CAPABILITIES = new Set(['tools', 'vision', 'thinking', 'fast', 'search'])
const TIERS = new Set(['free', 'pro'])
const STATUSES = new Set(['stable', 'preview', 'dev'])

function fail(message) {
  console.error(`sync-models: ${message}`)
  process.exit(1)
}

/** Basic shape check: the app validates again at runtime and tolerates extra fields. */
function validate(body) {
  const errors = []
  if (!body || typeof body !== 'object') return ['response is not a JSON object']
  if (!Array.isArray(body.groups) || body.groups.length === 0) return ['"groups" must be a non-empty array']
  const ids = new Set()
  body.groups.forEach((group, gi) => {
    const where = `groups[${gi}]`
    if (typeof group?.provider !== 'string') errors.push(`${where}.provider must be a string`)
    else if (!PROVIDERS.has(group.provider)) console.warn(`sync-models: ${where}.provider "${group.provider}" is unknown to this app version`)
    if (typeof group?.label !== 'string' || !group.label) errors.push(`${where}.label must be a non-empty string`)
    if (!Array.isArray(group?.models)) return errors.push(`${where}.models must be an array`)
    group.models.forEach((m, mi) => {
      const at = `${where}.models[${mi}]`
      if (typeof m?.id !== 'string' || !m.id) return errors.push(`${at}.id must be a non-empty string`)
      if (ids.has(m.id)) errors.push(`${at}: duplicate id "${m.id}"`)
      ids.add(m.id)
      if (typeof m.name !== 'string' || !m.name) errors.push(`${at}.name must be a non-empty string`)
      if (m.provider !== group.provider) errors.push(`${at}.provider must equal the group provider`)
      if (!Array.isArray(m.capabilities) || m.capabilities.some((c) => !CAPABILITIES.has(c)))
        errors.push(`${at}.capabilities has unknown values`)
      if (!TIERS.has(m.tier)) errors.push(`${at}.tier must be one of ${[...TIERS].join(', ')}`)
      if (!STATUSES.has(m.status)) errors.push(`${at}.status must be one of ${[...STATUSES].join(', ')}`)
      if (typeof m.contextWindow !== 'number' || m.contextWindow <= 0) errors.push(`${at}.contextWindow must be a positive number`)
    })
  })
  return errors
}

let body
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } })
  if (!res.ok) fail(`${url} returned HTTP ${res.status}`)
  body = await res.json()
} catch (err) {
  fail(`could not fetch ${url}: ${err instanceof Error ? err.message : err}`)
}

const errors = validate(body)
if (errors.length) fail(`invalid catalog from ${url}:\n  ${errors.join('\n  ')}`)

const snapshot = { version: String(body.version ?? 'snapshot'), groups: body.groups }
await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
const count = snapshot.groups.reduce((n, g) => n + g.models.length, 0)
console.log(`sync-models: wrote ${count} models (version ${snapshot.version}) to ${target}`)

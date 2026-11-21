import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Tests never read or write the user's real shared skills folder (~/.agents/skills): each file gets an
// empty one unless it sets its own. Otherwise results and timing depend on what the user has installed.
process.env.LLAMARUN_SKILLS_DIR ??= mkdtempSync(join(tmpdir(), 'llamarun-test-skills-'))

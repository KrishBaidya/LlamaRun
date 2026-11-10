// Bundles the Llama Run bench runner for plain Node (Electron replaced by bench/electron-stub.ts).
import { build } from 'esbuild'

await build({
  entryPoints: ['bench/llamarun-agent.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'bench/dist/llamarun-agent.mjs',
  alias: { electron: './bench/electron-stub.ts', '@shared': './src/shared' },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning'
})

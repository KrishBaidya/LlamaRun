import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PluginPermission } from '@shared/types'
import { pythonExecutable, sdkDir } from '../paths'
import { allows } from './permissions'
import { JsonRpcPeer } from './rpc'

type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>

/** What plugin_host.py reports after loading the plugin. */
export interface LoadInfo {
  module: string
  name: string
  loaded: boolean
  error: string | null
  hooks: string[]
  services: string[]
  subscriptions: string[]
  pythonVersion: string
  sdkVersion: string
}

export interface ProcessOptions {
  id: string
  name: string
  folder: string
  dataDir: string
  grants: PluginPermission[]
  debug: boolean
  /** Host API for this plugin (already bound to it and permission-checked). */
  handlers: Record<string, Handler>
  onNotification: (method: string, params: Record<string, unknown>) => void
  log: (level: string, message: string) => void
}

export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms)
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e))
    )
  })
}

/**
 * Environment for a plugin process. Plugins without the "filesystem"
 * permission get a minimal one whose home and app-data folders point into
 * their own data folder, so libraries that cache "in the home folder" stay
 * inside the sandbox, and nothing secret is inherited.
 */
export function pluginEnv(grants: PluginPermission[], dataDir: string): NodeJS.ProcessEnv {
  const tmp = join(dataDir, 'tmp')
  const base: NodeJS.ProcessEnv = {}
  if (allows(grants, 'filesystem')) {
    Object.assign(base, process.env)
    for (const key of Object.keys(base)) if (key.startsWith('PYTHON') || key.startsWith('ELECTRON')) delete base[key]
  } else {
    const keep = ['SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'SystemDrive', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'LANG', 'LC_ALL', 'TZ', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']
    for (const key of keep) if (process.env[key]) base[key] = process.env[key]
    const home = join(dataDir, 'home')
    Object.assign(base, {
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      XDG_CACHE_HOME: join(home, '.cache'),
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share')
    })
    mkdirSync(home, { recursive: true })
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT
    const path = [dirname(pythonExecutable())]
    if (process.platform === 'win32' && systemRoot) path.push(join(systemRoot, 'System32'))
    else path.push('/usr/bin', '/bin')
    base.PATH = path.join(process.platform === 'win32' ? ';' : ':')
  }
  mkdirSync(tmp, { recursive: true })
  return { ...base, TEMP: tmp, TMP: tmp, TMPDIR: tmp, LLAMARUN_PLUGIN: '1' }
}

/** One plugin running in its own bundled-Python process. */
export class PluginProcess extends EventEmitter<{ exit: [number | null] }> {
  private proc: ChildProcessWithoutNullStreams | null = null
  private peer: JsonRpcPeer | null = null
  private stopping = false
  info: LoadInfo | null = null

  constructor(readonly options: ProcessOptions) {
    super()
  }

  get running(): boolean {
    return this.peer !== null
  }

  get pid(): number | undefined {
    return this.proc?.pid
  }

  /** Spawns the host, waits for it, loads the plugin and returns what it reported. */
  start(): Promise<LoadInfo> {
    const { options: o } = this
    mkdirSync(o.dataDir, { recursive: true })
    const args = ['-I', '-X', 'utf8', '-B', '-u', join(sdkDir(), 'plugin_host.py'), '--plugin', o.folder, '--data', o.dataDir, '--grants', o.grants.join(',')]
    if (o.debug) args.push('--debug')
    const proc = spawn(pythonExecutable(), args, { env: pluginEnv(o.grants, o.dataDir), cwd: o.dataDir, windowsHide: true })
    this.proc = proc

    return new Promise<LoadInfo>((resolve, reject) => {
      let settled = false
      const fail = (err: Error): void => {
        if (!settled) {
          settled = true
          reject(err)
        }
      }
      const peer = new JsonRpcPeer(proc.stdout, proc.stdin, o.handlers, (method, params) => {
        if (method === 'host.ready' && !settled) {
          peer
            .request<LoadInfo>('plugin.load')
            .then((info) => {
              this.info = info
              settled = true
              resolve(info)
            }, fail)
          return
        }
        if (method === 'events.subscriptions' && this.info) {
          this.info = { ...this.info, subscriptions: ((params.topics as string[]) ?? []).filter((t) => !t.startsWith('$')) }
        }
        o.onNotification(method, params)
      })
      this.peer = peer

      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) if (line.trim()) o.log('info', line)
      })
      proc.on('error', fail)
      proc.on('exit', (code) => {
        peer.close(new Error(`${o.name} stopped`))
        this.proc = null
        this.peer = null
        fail(new Error(`Python exited with code ${code} while loading ${o.name}`))
        if (!this.stopping) this.emit('exit', code)
      })
    })
  }

  request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    if (!this.peer) return Promise.reject(new Error(`${this.options.name} is not running`))
    const call = this.peer.request<T>(method, params)
    return timeoutMs ? withTimeout(call, timeoutMs, `${this.options.name}: ${method}`) : call
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.peer?.notify(method, params)
  }

  /** Calls on_unload, then ends the process (killing it if it doesn't exit). */
  async stop(): Promise<void> {
    this.stopping = true
    const proc = this.proc
    if (!proc) return
    try {
      await this.request('plugin.unload', {}, 5000)
    } catch {
      // Best effort: fall through to closing stdin / killing.
    }
    proc.stdin.end()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill()
        resolve()
      }, 3000)
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  kill(): void {
    this.proc?.kill()
  }
}

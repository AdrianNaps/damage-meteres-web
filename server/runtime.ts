import type { WebSocketServer } from 'ws'
import { LiveLogSource } from './sources/liveSource.js'
import { ArchiveLogSource } from './sources/archiveSource.js'
import { SourceRegistry } from './sources/registry.js'
import { attachWsHandlers, type AttachedWsHandlers } from './wsServer.js'
import type { IconResolver } from './iconResolver.js'

export interface RuntimeOptions {
  logsDir: string
  maxSegments: number
  iconResolver: IconResolver
  wss: WebSocketServer
}

export interface Runtime {
  registry: SourceRegistry
  wsHandlers: AttachedWsHandlers
  setLogsDir(dir: string): void
  dispose(): void
}

// Single composition root for both the headless server and Electron entry
// points. Owns the source registry and WS handler bindings; wss lifecycle
// stays with the caller (different bind strategies: http-attached vs random
// port).
export function createRuntime(opts: RuntimeOptions): Runtime {
  const registry = new SourceRegistry()
  const live = new LiveLogSource({
    logsDir: opts.logsDir,
    maxSegments: opts.maxSegments,
    iconResolver: opts.iconResolver,
  })
  registry.add(live)
  live.start()

  // Factory closes over runtime config (maxSegments, iconResolver) so the WS
  // layer can construct archive sources without knowing how the runtime was
  // configured.
  const createArchiveSource = (filePath: string): ArchiveLogSource =>
    new ArchiveLogSource({
      filePath,
      maxSegments: opts.maxSegments,
      iconResolver: opts.iconResolver,
    })

  const wsHandlers = attachWsHandlers(opts.wss, registry, { createArchiveSource })

  return {
    registry,
    wsHandlers,
    setLogsDir(dir: string): void {
      registry.getLive().setLogsDir(dir)
    },
    dispose(): void {
      wsHandlers.stop()
      registry.dispose()
    },
  }
}

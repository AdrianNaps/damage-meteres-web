import Store from 'electron-store'

export interface WindowBounds {
  width: number
  height: number
  x?: number
  y?: number
}

export interface Settings {
  logsDir: string
  maxSegments: number
  windowBounds: WindowBounds
}

// Minimal type for the methods we use. The bundled electron-store typings
// extend `conf`, whose modern `"exports"` package map can't be resolved by
// our CommonJS tsconfig, so the inherited get/set surface is invisible to TS.
interface TypedStore {
  get<K extends keyof Settings>(key: K): Settings[K]
  set<K extends keyof Settings>(key: K, value: Settings[K]): void
}

const store = new Store<Settings>({
  defaults: {
    logsDir: 'C:/Program Files (x86)/World of Warcraft/_retail_/Logs',
    maxSegments: 10,
    windowBounds: { width: 1280, height: 800 },
  },
}) as unknown as TypedStore

export function getSettings(): Settings {
  return {
    logsDir: store.get('logsDir'),
    maxSegments: store.get('maxSegments'),
    windowBounds: store.get('windowBounds'),
  }
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  store.set(key, value)
}

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

// Resolves WoW spell IDs to Wowhead icon filenames (no extension).
// Results are cached in-memory and persisted to disk so future runs
// start warm. Unknown IDs are resolved lazily in the background via
// Wowhead's public tooltip JSON endpoint; callers never await.

// Hardcoded overrides for non-spell synthetic IDs used by the parser.
const STATIC: Record<string, string> = {
  swing: 'inv_sword_04',
}

export interface IconResolverOptions {
  cacheFile: string
}

export function createIconResolver(opts: IconResolverOptions) {
  const { cacheFile } = opts

  const cache: Record<string, string> = loadCache(cacheFile)
  const inFlight = new Set<string>()
  let writeTimer: NodeJS.Timeout | null = null

  for (const [k, v] of Object.entries(STATIC)) {
    if (!cache[k]) cache[k] = v
  }

  function scheduleWrite() {
    if (writeTimer) return
    writeTimer = setTimeout(() => {
      writeTimer = null
      try {
        const dir = dirname(cacheFile)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        // Strip negative entries from the persisted file so we retry them next run.
        const persist: Record<string, string> = {}
        for (const [k, v] of Object.entries(cache)) {
          if (v) persist[k] = v
        }
        writeFileSync(cacheFile, JSON.stringify(persist, null, 2))
      } catch (err) {
        console.warn('[iconResolver] failed to write cache:', (err as Error).message)
      }
    }, 2000)
  }

  async function fetchIcon(spellId: string): Promise<string | null> {
    try {
      const res = await fetch(`https://nether.wowhead.com/tooltip/spell/${spellId}`, {
        headers: { 'User-Agent': 'details-web-app/1.0' },
      })
      if (!res.ok) return null
      const data = await res.json() as { icon?: string }
      return typeof data.icon === 'string' && data.icon.length > 0 ? data.icon : null
    } catch {
      return null
    }
  }

  function request(spellId: string) {
    if (!spellId) return
    if (spellId in cache) return
    if (inFlight.has(spellId)) return
    inFlight.add(spellId)
    fetchIcon(spellId).then(icon => {
      cache[spellId] = icon ?? ''
      inFlight.delete(spellId)
      if (icon) scheduleWrite()
    })
  }

  return {
    // Fire-and-forget: kick off lookups for any unknown IDs.
    requestMany(spellIds: Iterable<string>) {
      for (const id of spellIds) request(id)
    },

    // Snapshot of the current cache, with negative entries filtered out.
    getAll(): Record<string, string> {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(cache)) {
        if (v) out[k] = v
      }
      return out
    },
  }
}

export type IconResolver = ReturnType<typeof createIconResolver>

function loadCache(file: string): Record<string, string> {
  try {
    if (!existsSync(file)) return {}
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch (err) {
    console.warn('[iconResolver] failed to load cache:', (err as Error).message)
    return {}
  }
}

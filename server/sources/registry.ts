import type { LogSource } from './types.js'
import type { LiveLogSource } from './liveSource.js'
import type { ArchiveLogSource } from './archiveSource.js'

// Cap on concurrently-loaded archive sources. Tuned to balance "user can compare
// across a few sessions" against per-source memory cost (each source holds its
// own SegmentStore with full event arrays). Bumpable later if it feels tight.
export const ARCHIVE_CAP = 3

export class SourceRegistry {
  private sources = new Map<string, LogSource>()
  // Touched on every routable request for an archive; LRU eviction picks the
  // archive with the oldest timestamp. Live source is excluded — it never
  // evicts.
  private lastAccessed = new Map<string, number>()

  add(source: LogSource): void {
    this.sources.set(source.id, source)
    if (source.kind === 'archive') {
      this.lastAccessed.set(source.id, Date.now())
    }
  }

  get(id: string): LogSource | undefined {
    return this.sources.get(id)
  }

  // Convenience accessor for the privileged live source. The runtime wires it
  // up at startup; callers that always operate on live can skip the lookup.
  getLive(): LiveLogSource {
    const source = this.sources.get('live')
    if (!source || source.kind !== 'live') {
      throw new Error('Live source not registered')
    }
    return source as LiveLogSource
  }

  getAll(): LogSource[] {
    return Array.from(this.sources.values())
  }

  getArchives(): ArchiveLogSource[] {
    const out: ArchiveLogSource[] = []
    for (const s of this.sources.values()) {
      if (s.kind === 'archive') out.push(s as ArchiveLogSource)
    }
    return out
  }

  // Bumps the lastAccessed timestamp for an archive. No-op for the live source
  // and for ids that aren't currently registered.
  touch(sourceId: string): void {
    if (this.lastAccessed.has(sourceId)) {
      this.lastAccessed.set(sourceId, Date.now())
    }
  }

  // Returns the id that *would* be evicted if a new archive were added at cap,
  // without performing the eviction. Used to populate LRU warnings in the UI
  // before the user commits to opening a new file.
  peekLruArchive(): string | null {
    const archives = this.getArchives()
    if (archives.length < ARCHIVE_CAP) return null
    let lruId: string | null = null
    let lruTime = Infinity
    for (const a of archives) {
      const t = this.lastAccessed.get(a.id) ?? 0
      if (t < lruTime) { lruTime = t; lruId = a.id }
    }
    return lruId
  }

  // Evicts the LRU archive if at cap. Returns the evicted id (caller broadcasts
  // source_closed) or null if eviction wasn't needed.
  evictLruArchiveIfAtCap(): string | null {
    const lruId = this.peekLruArchive()
    if (lruId) this.removeArchive(lruId)
    return lruId
  }

  removeArchive(sourceId: string): boolean {
    const source = this.sources.get(sourceId)
    if (!source || source.kind !== 'archive') return false
    source.dispose()
    this.sources.delete(sourceId)
    this.lastAccessed.delete(sourceId)
    return true
  }

  dispose(): void {
    for (const source of this.sources.values()) {
      source.dispose()
    }
    this.sources.clear()
    this.lastAccessed.clear()
  }
}

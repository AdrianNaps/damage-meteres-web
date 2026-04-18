import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useStore, selectCurrentView, resolveSpecId } from '../store'
import { spellIconUrl } from '../utils/icons'
import { shortName } from '../utils/format'
import { getClassColor } from './PlayerRow'
import type { AuraWindowWire, BuffSection } from '../types'

// Per-target drill for a selected buff row. Shows one row per recipient with
// their individual uptime %, application count, and a mini timeline. Recipient
// names are class-colored; clicking a name narrows the Recipient filter to
// that player so the main buffs table re-scopes in sync.

const SECTION_LABELS: Record<BuffSection, string> = {
  personal: 'Personal',
  raid: 'Raid',
  external: 'External',
}

const SECTION_BAR_COLORS: Record<BuffSection, string> = {
  personal: '#64748b',
  raid: '#22c55e',
  external: '#f59e0b',
}

const TIMELINE_HEIGHT = 8
const ROW_GRID = '180px 60px 1fr 60px'

export function BuffBreakdownPanel() {
  const selectedBuff = useStore(s => s.selectedBuff)
  const setSelectedBuff = useStore(s => s.setSelectedBuff)
  const currentView = useStore(selectCurrentView)
  const playerSpecs = useStore(s => s.playerSpecs)
  const setFilter = useStore(s => s.setFilter)
  const filters = useStore(s => s.filters)

  // Escape closes the drill. Mirrors BreakdownPanel's key handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedBuff(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSelectedBuff])

  const scope = useMemo(() => {
    if (!currentView) return null
    const t0 = currentView.startTime
    const tEndRaw = currentView.endTime
    const durationSec =
      'duration' in currentView ? currentView.duration
      : 'activeDurationSec' in currentView ? currentView.activeDurationSec
      : 0
    const tEnd = tEndRaw ?? (t0 + durationSec * 1000)
    return { t0, tEnd }
  }, [currentView])

  const { targetRows, spell } = useMemo(() => {
    if (!currentView || !selectedBuff || !scope) return { targetRows: [], spell: null as null | { id: string; name: string; section: BuffSection } }
    const auras: AuraWindowWire[] = currentView.auras ?? []
    const matching = auras.filter(w => w.id === selectedBuff)
    if (matching.length === 0) return { targetRows: [], spell: null }

    // Apply the Caster filter so the drill matches what the main table shows.
    // Recipient + Buff filters are deliberately ignored here: Recipient would
    // collapse the per-target view to one row (defeats the point), and Buff
    // is already pinned to selectedBuff.
    const casterFilter = filters.Source
    const filtered = casterFilter
      ? matching.filter(w => casterFilter.includes(w.c))
      : matching

    const spellName = matching[0].n

    // Infer section from the snapshot's classification map.
    const classification = currentView.buffClassification ?? {}
    const section = classification[selectedBuff] ?? 'external'

    type TargetAgg = { target: string; count: number; windows: AuraWindowWire[] }
    const byTarget = new Map<string, TargetAgg>()
    for (const w of filtered) {
      let agg = byTarget.get(w.d)
      if (!agg) {
        agg = { target: w.d, count: 0, windows: [] }
        byTarget.set(w.d, agg)
      }
      // Refresh-aware count — matches the main table's convention.
      agg.count += 1 + (w.r ?? 0)
      agg.windows.push(w)
    }

    const scopeMs = scope.tEnd - scope.t0
    const rows = [...byTarget.values()].map(a => ({
      ...a,
      uptimeMs: unionMs(a.windows, scope.t0, scope.tEnd),
      uptimePct: 0,
    })).map(r => ({
      ...r,
      uptimePct: scopeMs > 0 ? (r.uptimeMs / scopeMs) * 100 : 0,
    }))
    rows.sort((a, b) => b.uptimePct - a.uptimePct)

    return {
      targetRows: rows,
      spell: { id: selectedBuff, name: spellName, section },
    }
  }, [currentView, selectedBuff, scope, filters.Source])

  if (!selectedBuff || !currentView || !spell || !scope) return null

  const iconName = useStore.getState().spellIcons[selectedBuff]
  const iconUrl = spellIconUrl(iconName)
  const accentColor = SECTION_BAR_COLORS[spell.section]

  return (
    <>
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{
          borderBottom: '1px solid var(--border-default)',
          borderLeft: `4px solid ${accentColor}`,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {iconUrl && (
              <img
                src={iconUrl}
                alt=""
                width={20}
                height={20}
                style={{ flexShrink: 0, border: '1px solid rgba(0,0,0,0.7)', borderRadius: 2 }}
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
            )}
            <span className="truncate" style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
              {spell.name}
            </span>
            <span style={{
              fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
              padding: '1px 6px', borderRadius: 2,
              background: 'var(--bg-active)', color: accentColor,
            }}>
              {SECTION_LABELS[spell.section]}
            </span>
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginTop: 2 }}>
            {targetRows.length} {targetRows.length === 1 ? 'recipient' : 'recipients'}
          </div>
        </div>
        <button
          onClick={() => setSelectedBuff(null)}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '4px 8px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          &times;
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: ROW_GRID,
            gap: 12,
            padding: '6px 14px',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: 10,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-muted)',
          }}
        >
          <span>Recipient</span>
          <span style={{ textAlign: 'right' }}>Uptime %</span>
          <span>Uptime</span>
          <span style={{ textAlign: 'right' }}>Count</span>
        </div>
        {targetRows.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            No windows for this buff under the current filters.
          </div>
        ) : targetRows.map(row => (
          <TargetRow
            key={row.target}
            name={row.target}
            uptimePct={row.uptimePct}
            count={row.count}
            windows={row.windows}
            t0Ms={scope.t0}
            tEndMs={scope.tEnd}
            color={getClassColor(resolveSpecId(playerSpecs, row.target))}
            barColor={accentColor}
            onClick={() => setFilter('Target', [row.target])}
          />
        ))}
      </div>
    </>
  )
}

function TargetRow({
  name,
  uptimePct,
  count,
  windows,
  t0Ms,
  tEndMs,
  color,
  barColor,
  onClick,
}: {
  name: string
  uptimePct: number
  count: number
  windows: AuraWindowWire[]
  t0Ms: number
  tEndMs: number
  color: string
  barColor: string
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: ROW_GRID,
        gap: 12,
        alignItems: 'center',
        padding: '6px 14px',
        minHeight: 28,
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <span className="truncate" style={{ fontSize: 13, color, minWidth: 0 }}>
        {shortName(name)}
      </span>
      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--text-primary)' }}>
        {uptimePct.toFixed(1)}%
      </span>
      <MiniTimeline windows={windows} t0Ms={t0Ms} tEndMs={tEndMs} color={barColor} />
      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--text-secondary)' }}>
        {count}
      </span>
    </div>
  )
}

// Lightweight mirror of the main-table BuffTimelineBar, sized for the drill's
// narrower grid. Kept local rather than extracted because the two contexts
// have diverging visual needs (section color on main, target accent here).
function MiniTimeline({
  windows,
  t0Ms,
  tEndMs,
  color,
}: {
  windows: AuraWindowWire[]
  t0Ms: number
  tEndMs: number
  color: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const cssW = container.clientWidth
    const cssH = TIMELINE_HEIGHT
    if (cssW <= 0) return
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    ctx.fillRect(0, 0, cssW, cssH)

    const scopeMs = tEndMs - t0Ms
    if (scopeMs <= 0 || windows.length === 0) return

    const sorted = windows
      .map<[number, number]>(w => [Math.max(w.s, t0Ms), Math.min(w.e, tEndMs)])
      .filter(([s, e]) => e > s)
      .sort((a, b) => a[0] - b[0])
    if (sorted.length === 0) return

    ctx.fillStyle = color
    ctx.globalAlpha = 0.85
    let curStart = sorted[0][0]
    let curEnd = sorted[0][1]
    const flush = () => {
      const x0 = ((curStart - t0Ms) / scopeMs) * cssW
      const x1 = ((curEnd - t0Ms) / scopeMs) * cssW
      const w = Math.max(1, x1 - x0)
      ctx.fillRect(Math.floor(x0), 0, Math.ceil(w), cssH)
    }
    for (let i = 1; i < sorted.length; i++) {
      const [s, e] = sorted[i]
      if (s <= curEnd) {
        if (e > curEnd) curEnd = e
      } else {
        flush()
        curStart = s
        curEnd = e
      }
    }
    flush()
    ctx.globalAlpha = 1
  }, [windows, t0Ms, tEndMs, color])

  useEffect(() => {
    draw()
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(container)
    return () => ro.disconnect()
  }, [draw])

  return (
    <div ref={containerRef} style={{ height: TIMELINE_HEIGHT, display: 'flex', alignItems: 'center', minWidth: 0 }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  )
}

function unionMs(windows: AuraWindowWire[], t0Ms: number, tEndMs: number): number {
  if (windows.length === 0) return 0
  const intervals: [number, number][] = []
  for (const w of windows) {
    const s = Math.max(w.s, t0Ms)
    const e = Math.min(w.e, tEndMs)
    if (e > s) intervals.push([s, e])
  }
  if (intervals.length === 0) return 0
  intervals.sort((a, b) => a[0] - b[0])
  let total = 0
  let cs = intervals[0][0]
  let ce = intervals[0][1]
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i]
    if (s <= ce) {
      if (e > ce) ce = e
    } else {
      total += ce - cs
      cs = s
      ce = e
    }
  }
  total += ce - cs
  return total
}

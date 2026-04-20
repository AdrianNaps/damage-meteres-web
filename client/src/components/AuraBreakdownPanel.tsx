import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, selectCurrentView } from '../store'
import { spellIconUrl } from '../utils/icons'
import { usePlayerRowStyle } from '../utils/usePlayerRowStyle'
import { SegmentedControl } from './SegmentedControl'
import type { AuraWindowWire, BuffSection } from '../types'

// Drill panel for a selected aura row (buff or debuff). Renders two toggled
// views of the same window set: Recipients/Targets (per-target uptime) and
// Casters (per-caster uptime). Clicking a row narrows the matching global
// filter so the main aura table re-scopes in sync — Recipient → filters.Target,
// Caster → filters.Source.

type ViewMode = 'recipients' | 'casters'

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

// Debuffs have no section taxonomy — pick a neutral accent so the header
// stripe and timeline bars don't read as a buff category.
const DEBUFF_ACCENT_COLOR = '#a855f7'

const TIMELINE_HEIGHT = 8
const ROW_GRID = '180px 60px 1fr 60px'

export function AuraBreakdownPanel() {
  const selectedAura = useStore(s => s.selectedAura)
  const setSelectedAura = useStore(s => s.setSelectedAura)
  const metric = useStore(s => s.metric)
  const currentView = useStore(selectCurrentView)
  const setFilter = useStore(s => s.setFilter)
  const filters = useStore(s => s.filters)
  const perspective = useStore(s => s.perspective)
  const resolveRowStyle = usePlayerRowStyle()
  const [viewMode, setViewMode] = useState<ViewMode>('recipients')
  // Subscribed (not `useStore.getState()`) so the header icon fills in when
  // the async icon resolver lands a name for this spellId after the panel
  // has already mounted.
  const iconName = useStore(s => selectedAura ? s.spellIcons[selectedAura] : undefined)

  const isDebuff = metric === 'debuffs'

  // Escape closes the drill. Mirrors BreakdownPanel's key handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedAura(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSelectedAura])

  const scope = useMemo(() => {
    if (!currentView) return null
    const t0 = currentView.startTime
    const tEndRaw = currentView.endTime
    const durationSec = currentView.duration
    const tEnd = tEndRaw ?? (t0 + durationSec * 1000)
    return { t0, tEnd }
  }, [currentView])

  const { targetRows, casterRows, spell } = useMemo(() => {
    const empty = { targetRows: [] as Row[], casterRows: [] as Row[], spell: null as null | { id: string; name: string; section: BuffSection | null } }
    if (!currentView || !selectedAura || !scope) return empty
    const auras: AuraWindowWire[] = currentView.auras ?? []
    const allies = currentView.players ?? {}
    const allySet = new Set(Object.keys(allies))
    // Mirror the main table's partition: allies view keeps ally recipients
    // (by name), enemies view keeps only REACTION_HOSTILE targets so player
    // pets / totems / guardians don't leak into the enemy list. Kind is
    // locked to whichever aura tab is active — selecting a buff row can't
    // pull debuff windows into view and vice versa.
    const wantDebuff = isDebuff
    const matching = auras.filter(w => {
      if (w.id !== selectedAura) return false
      const isDebuffWindow = w.k === 1
      if (wantDebuff !== isDebuffWindow) return false
      return perspective === 'allies' ? allySet.has(w.d) : w.h === 1
    })
    if (matching.length === 0) return empty

    const spellName = matching[0].n
    // Buffs carry a section; debuffs don't (render flat).
    const classification = currentView.buffClassification ?? {}
    const section = isDebuff ? null : (classification[selectedAura] ?? 'external')
    const scopeMs = scope.tEnd - scope.t0

    // Symmetric drill filtering: each axis view applies the OTHER axis's
    // filter. Recipients view respects the Caster chip (so if the main table
    // is filtered to "by caster X", the drill shows "recipients of X's casts")
    // and vice versa. The drill's own axis is skipped — applying it would
    // collapse the view to a single row.
    const casterFilter = filters.Source
    const recipientFilter = filters.Target
    const forRecipients = casterFilter
      ? matching.filter(w => casterFilter.includes(w.c))
      : matching
    const forCasters = recipientFilter
      ? matching.filter(w => recipientFilter.includes(w.d))
      : matching

    return {
      targetRows: bucketRows(forRecipients, w => w.d, scope, scopeMs, resolveRowStyle),
      casterRows: bucketRows(forCasters, w => w.c, scope, scopeMs, resolveRowStyle),
      spell: { id: selectedAura, name: spellName, section },
    }
  }, [currentView, selectedAura, scope, filters.Source, filters.Target, perspective, resolveRowStyle, isDebuff])

  if (!selectedAura || !currentView || !spell || !scope) return null

  const iconUrl = spellIconUrl(iconName)
  const accentColor = spell.section ? SECTION_BAR_COLORS[spell.section] : DEBUFF_ACCENT_COLOR
  const activeRows = viewMode === 'recipients' ? targetRows : casterRows
  const recipientLabel = isDebuff ? 'Targets' : 'Recipients'
  const recipientHeader = isDebuff ? 'Target' : 'Recipient'

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
            {spell.section && (
              <span style={{
                fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                padding: '1px 6px', borderRadius: 2,
                background: 'var(--bg-active)', color: accentColor,
              }}>
                {SECTION_LABELS[spell.section]}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginTop: 2 }}>
            {activeRows.length} {countLabel(activeRows.length, viewMode, isDebuff)}
          </div>
        </div>
        <button
          onClick={() => setSelectedAura(null)}
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

      <div className="px-4 pt-2.5">
        <SegmentedControl<ViewMode>
          options={[
            { key: 'recipients', label: recipientLabel },
            { key: 'casters', label: 'Casters' },
          ]}
          active={viewMode}
          onChange={setViewMode}
        />
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
          <span>{viewMode === 'recipients' ? recipientHeader : 'Caster'}</span>
          <span style={{ textAlign: 'right' }}>Uptime %</span>
          <span>Uptime</span>
          <span style={{ textAlign: 'right' }}>Count</span>
        </div>
        {activeRows.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            No windows for this {isDebuff ? 'debuff' : 'buff'} under the current filters.
          </div>
        ) : activeRows.map(row => (
          <TargetRow
            key={row.name}
            displayName={row.displayName}
            uptimePct={row.uptimePct}
            count={row.count}
            windows={row.windows}
            t0Ms={scope.t0}
            tEndMs={scope.tEnd}
            color={row.classColor}
            barColor={accentColor}
            onClick={() => setFilter(viewMode === 'recipients' ? 'Target' : 'Source', [row.name])}
          />
        ))}
      </div>
    </>
  )
}

function countLabel(n: number, view: ViewMode, isDebuff: boolean): string {
  if (view === 'recipients') {
    if (isDebuff) return n === 1 ? 'target' : 'targets'
    return n === 1 ? 'recipient' : 'recipients'
  }
  return n === 1 ? 'caster' : 'casters'
}

function TargetRow({
  displayName,
  uptimePct,
  count,
  windows,
  t0Ms,
  tEndMs,
  color,
  barColor,
  onClick,
}: {
  displayName: string
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
        {displayName}
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

// Row emitted for both Recipients and Casters views. `name` is the grouping
// key (target for recipients, caster for casters) and is what the click
// handler passes to setFilter.
interface Row {
  name: string
  displayName: string
  classColor: string
  uptimeMs: number
  uptimePct: number
  count: number
  windows: AuraWindowWire[]
}

// Bucket windows by a chosen axis (target or caster), compute uptime%/count
// per bucket, and resolve ally styling. Shared between the two drill views —
// the only thing that differs is the key extractor.
function bucketRows(
  windows: AuraWindowWire[],
  keyOf: (w: AuraWindowWire) => string,
  scope: { t0: number; tEnd: number },
  scopeMs: number,
  resolveStyle: ReturnType<typeof usePlayerRowStyle>,
): Row[] {
  type Agg = { name: string; count: number; windows: AuraWindowWire[] }
  const by = new Map<string, Agg>()
  for (const w of windows) {
    const k = keyOf(w)
    let agg = by.get(k)
    if (!agg) {
      agg = { name: k, count: 0, windows: [] }
      by.set(k, agg)
    }
    // Refresh-aware count — matches the main table's convention.
    agg.count += 1 + (w.r ?? 0)
    agg.windows.push(w)
  }
  const rows: Row[] = [...by.values()].map(a => {
    const uptimeMs = unionMs(a.windows, scope.t0, scope.tEnd)
    const style = resolveStyle(a.name)
    return {
      name: a.name,
      count: a.count,
      windows: a.windows,
      uptimeMs,
      uptimePct: scopeMs > 0 ? (uptimeMs / scopeMs) * 100 : 0,
      displayName: style?.displayName ?? a.name,
      classColor: style?.color ?? 'var(--text-secondary)',
    }
  })
  rows.sort((a, b) => b.uptimePct - a.uptimePct)
  return rows
}

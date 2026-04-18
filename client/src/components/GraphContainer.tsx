import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import type { PlayerSnapshot } from '../types'
import { getClassColor } from './PlayerRow'
import { useStore, resolveSpecId, GRAPH_GROUP_AVG_KEY, selectGraphTimeOffset } from '../store'
import { formatNum, shortName, formatTime } from '../utils/format'

interface Props {
  metric: 'damage' | 'healing' | 'deaths' | 'interrupts'
  players: Record<string, PlayerSnapshot>
  duration: number
  inactive?: boolean
}

const PAD = { top: 4, right: 8, bottom: 16, left: 40 }

const UNFOCUSED_ALPHA = 0.18
const GROUP_AVG_COLOR = '#f59e0b'

// Below this pixel threshold, a mousedown→mouseup counts as a click (passes
// through to existing hover/focus behaviors). Past the threshold, we treat it
// as an intentional time-window selection.
const MIN_DRAG_PX = 3
const TIME_WINDOW_FILL = 'rgba(59, 130, 246, 0.14)'
const TIME_WINDOW_BORDER = 'rgba(96, 165, 250, 0.55)'
const TIME_WINDOW_SHADE = 'rgba(8, 10, 14, 0.55)'

// Slice width for the line graph series. Scaled with duration so short fights
// get fine-grained sampling and long dungeon overalls don't produce thousands
// of points. Real server-side data will eventually supply pre-bucketed series;
// until then, this shapes both the synthetic line resolution and the hover-
// tooltip granularity.
function getLineBucketSec(duration: number): number {
  if (duration <= 60) return 1
  if (duration <= 180) return 2
  if (duration <= 600) return 3
  if (duration <= 1500) return 5
  return 10
}

// Canvas ctx.font does NOT resolve CSS custom properties — use concrete font families.
const MONO_FONT = '10px "Geist Mono", ui-monospace, monospace'
const SANS_FONT = '11px "Geist Sans", ui-sans-serif, system-ui, sans-serif'

function hashStr(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Deterministic pseudo-random series for a player, seeded by name
function generateSeries(base: number, name: string, points: number): number[] {
  const data: number[] = []
  let seed = hashStr(name)
  for (let i = 0; i <= points; i++) {
    seed = (seed * 16807 + 12345) & 0x7fffffff
    const noise = (seed / 0x7fffffff - 0.5) * 0.6
    data.push(Math.max(0, base * (0.7 + noise + Math.sin(i * 0.3) * 0.15)))
  }
  return data
}

interface SeriesEntry {
  name: string
  displayName: string
  data: number[]
  color: string
}
interface LineData {
  series: SeriesEntry[]
  avgData: number[]
  points: number
  bucketSec: number
  maxVal: number
}

interface HoverState { slice: number; xCss: number }

interface BarTooltipRow {
  combatElapsed: number
  playerName: string
  color: string
  // deaths
  killingSpellName?: string
  sourceName?: string
  // interrupts (populated once server provides per-event records)
  kickerSpellName?: string
  kickedSpellName?: string
  targetName?: string
}

interface BarSeries { playerName: string; color: string; buckets: number[] }

interface BarData {
  series: BarSeries[]
  bucketRecords: BarTooltipRow[][]
  bucketCount: number
  bucketSec: number
}

interface BarHoverState { bucket: number; seriesIndex: number; xCss: number }

export function GraphContainer({ metric, players, duration, inactive }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const playerSpecs = useStore(s => s.playerSpecs)

  // Memoize so the draw callback and the ResizeObserver effect stay stable
  // across renders where players hasn't changed.
  const playerList = useMemo(() => Object.values(players), [players])

  // Focus state lives in the store so it survives GraphContainer unmounts that
  // happen between a segment click and the server's snapshot response.
  const focused = useStore(s => s.graphFocused)
  const toggleFocus = useStore(s => s.toggleGraphFocus)
  const timeOffset = useStore(selectGraphTimeOffset)

  // TimeWindow filter (drag-selected band). Stored in segment-relative seconds
  // so the overlay lines up with the graph's visible x-axis without needing a
  // separate time basis from the events array. Drag-to-select is gated to Full
  // mode because that's the only mode where filters actually narrow data — a
  // drag in Summary would set a chip the user can't see (FilterBar is hidden)
  // and have no effect on the pre-aggregated snapshot values.
  const timeWindowFilter = useStore(s => s.filters.TimeWindow)
  const setTimeWindowFilter = useStore(s => s.setTimeWindowFilter)
  const mode = useStore(s => s.mode)

  const [hover, setHover] = useState<HoverState | null>(null)
  const [barHover, setBarHover] = useState<BarHoverState | null>(null)
  // Drag-select state. Both fields are canvas-CSS-pixel x coordinates (relative
  // to the canvas left edge). A drag is "active" whenever this is non-null; on
  // mouseup we decide whether to commit (movement past MIN_DRAG_PX) or discard
  // (treat as a click and leave hover/focus behaviors to the existing handlers).
  const [drag, setDrag] = useState<{ startX: number; currentX: number } | null>(null)

  const isBar = metric === 'deaths' || metric === 'interrupts'
  const dragEnabled = !inactive && !isBar && mode === 'full'

  // Bar data — bucketed counts plus per-bucket tooltip records. Computed once
  // per metric/players/duration change so the renderer and the hover tooltip
  // share the same bucketing. Deaths use real PlayerDeathRecord timestamps;
  // interrupts still produce synthetic counts (no per-event records yet) and
  // therefore have empty record arrays — tooltip is suppressed for those buckets.
  const barData = useMemo<BarData | null>(() => {
    if (!isBar) return null

    const bucketSec = duration > 400 ? 60 : 30
    const bucketCount = Math.max(1, Math.ceil(duration / bucketSec))
    const bucketRecords: BarTooltipRow[][] = Array.from({ length: bucketCount }, () => [])

    const playerMap = new Map<string, BarSeries>()

    if (metric === 'deaths') {
      playerList.forEach(p => {
        const specId = resolveSpecId(playerSpecs, p.name, p.specId)
        const color = getClassColor(specId)
        p.deaths.forEach(d => {
          let series = playerMap.get(d.playerName)
          if (!series) {
            series = { playerName: d.playerName, color, buckets: new Array(bucketCount).fill(0) }
            playerMap.set(d.playerName, series)
          }
          const bucket = Math.min(Math.floor(d.combatElapsed / bucketSec), bucketCount - 1)
          series.buckets[bucket]++
          bucketRecords[bucket].push({
            combatElapsed: d.combatElapsed,
            playerName: d.playerName,
            color,
            killingSpellName: d.killingBlow?.spellName ?? 'Unknown',
            sourceName: d.killingBlow?.sourceName ?? 'Unknown',
          })
        })
      })
    } else {
      // interrupts — one row per PlayerInterruptRecord, bucketed by combatElapsed.
      playerList.forEach(p => {
        const specId = resolveSpecId(playerSpecs, p.name, p.specId)
        const color = getClassColor(specId)
        p.interrupts.records.forEach(r => {
          let series = playerMap.get(r.kickerName)
          if (!series) {
            series = { playerName: r.kickerName, color, buckets: new Array(bucketCount).fill(0) }
            playerMap.set(r.kickerName, series)
          }
          const bucket = Math.min(Math.floor(r.combatElapsed / bucketSec), bucketCount - 1)
          series.buckets[bucket]++
          bucketRecords[bucket].push({
            combatElapsed: r.combatElapsed,
            playerName: r.kickerName,
            color,
            kickerSpellName: r.kickerSpellName,
            kickedSpellName: r.kickedSpellName,
            targetName: r.targetName,
          })
        })
      })
    }

    if (playerMap.size === 0) return null

    bucketRecords.forEach(rs => rs.sort((a, b) => a.combatElapsed - b.combatElapsed))
    const series = [...playerMap.values()].sort(
      (a, b) => b.buckets.reduce((s, v) => s + v, 0) - a.buckets.reduce((s, v) => s + v, 0)
    )
    return { series, bucketRecords, bucketCount, bucketSec }
  }, [isBar, metric, playerList, playerSpecs, duration])

  // Line data — generated once per metric/players/duration change and shared
  // between the canvas renderer and the hover tooltip so both read identical
  // slice values.
  const lineData = useMemo<LineData | null>(() => {
    if (isBar) return null
    const rateFn = metric === 'damage' ? (p: PlayerSnapshot) => p.dps : (p: PlayerSnapshot) => p.hps
    const sorted = [...playerList].sort((a, b) => rateFn(b) - rateFn(a)).slice(0, 5)
    if (sorted.length === 0 || rateFn(sorted[0]) === 0) return null

    const bucketSec = getLineBucketSec(duration)
    const points = Math.max(4, Math.ceil(duration / bucketSec))

    const series: SeriesEntry[] = sorted.map(p => {
      const specId = resolveSpecId(playerSpecs, p.name, p.specId)
      return {
        name: p.name,
        displayName: shortName(p.name),
        data: generateSeries(rateFn(p), p.name, points),
        color: getClassColor(specId),
      }
    })

    const avgData: number[] = []
    for (let i = 0; i <= points; i++) {
      let sum = 0
      series.forEach(s => { sum += s.data[i] })
      avgData.push(sum / series.length)
    }

    let maxVal = 0
    series.forEach(s => s.data.forEach(v => { if (v > maxVal) maxVal = v }))
    maxVal *= 1.1

    return { series, avgData, points, bucketSec, maxVal }
  }, [isBar, metric, playerList, playerSpecs, duration])

  // Clear hover state when the underlying data goes away (e.g. switching to a
  // bar metric). The slice/bucket index would otherwise point into a stale series.
  useEffect(() => {
    if (!lineData) setHover(null)
  }, [lineData])
  useEffect(() => {
    if (!barData) setBarHover(null)
  }, [barData])

  // Cancel any in-flight drag when the underlying line data vanishes (e.g. the
  // user navigates to a different scope mid-drag) or the graph flips into its
  // inactive placeholder state. Without this, a silent mouseup would still
  // commit a TimeWindow filter against the wrong scope.
  useEffect(() => {
    if ((!lineData || inactive) && drag) setDrag(null)
  }, [lineData, inactive, drag])

  // Window-level mouseup so a drag that escapes the canvas still commits. Only
  // bound while a drag is active; tears down immediately after. The commit
  // logic: short drags (<MIN_DRAG_PX) are treated as clicks and discarded so
  // they don't accidentally clobber an existing TimeWindow filter.
  useEffect(() => {
    if (!drag) return
    const canvas = canvasRef.current
    if (!canvas) return

    const onUp = () => {
      const rect = canvas.getBoundingClientRect()
      const pixelDelta = Math.abs(drag.currentX - drag.startX)
      if (pixelDelta < MIN_DRAG_PX) {
        setDrag(null)
        return
      }
      // Inline pixel→seconds conversion so this effect closure doesn't depend
      // on the un-memoized helper (would re-bind every render). Same math as
      // secondsFromCanvasX — if you change one, change the other.
      const plotW = rect.width - PAD.left - PAD.right
      const toSec = (xCss: number) => {
        if (plotW <= 0) return 0
        const xInPlot = Math.max(0, Math.min(plotW, xCss - PAD.left))
        return (xInPlot / plotW) * duration
      }
      const startSec = toSec(Math.min(drag.startX, drag.currentX))
      const endSec = toSec(Math.max(drag.startX, drag.currentX))
      // Guard against zero-width after rounding/clamping (happens when the
      // whole drag lives in the padding region on a tiny canvas).
      if (endSec > startSec) {
        setTimeWindowFilter({ startSec, endSec })
      }
      setDrag(null)
    }

    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [drag, duration, setTimeWindowFilter])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    if (inactive) {
      drawInactiveState(ctx, w, h)
      return
    }

    const plotW = w - PAD.left - PAD.right
    const plotH = h - PAD.top - PAD.bottom

    if (isBar) {
      if (barData) drawBars(ctx, h, plotW, plotH, barData, timeOffset, barHover?.bucket ?? null, barHover?.seriesIndex ?? null)
      else drawEmptyState(ctx, w, h)
    } else if (lineData) {
      // Suppress the hover crosshair during an active drag — the drag rect
      // becomes the primary visual, and the crosshair would clutter it.
      const hoverSlice = drag ? null : (hover?.slice ?? null)
      drawLineGraph(ctx, h, plotW, plotH, lineData, focused, duration, timeOffset, hoverSlice)

      // Overlay stack on top of the line graph:
      //   1. An active drag always wins — shows the live selection rect only.
      //   2. Otherwise, if a TimeWindow filter is committed, shade outside
      //      the window so the selected band stays bright.
      if (drag) {
        drawDragRect(ctx, plotW, plotH, drag)
      } else if (timeWindowFilter && duration > 0) {
        shadeOutsideWindow(ctx, plotW, plotH, duration, timeWindowFilter.startSec, timeWindowFilter.endSec)
      }
    } else {
      drawEmptyState(ctx, w, h)
    }
  }, [isBar, barData, lineData, focused, duration, timeOffset, hover, barHover, inactive, drag, timeWindowFilter])

  useEffect(() => {
    draw()
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(container)
    return () => ro.disconnect()
  }, [draw])

  // Build legend data
  const legendEntries = buildLegend(playerList, playerSpecs, metric, isBar)

  const title = metric === 'damage' ? 'DPS Over Time'
    : metric === 'healing' ? 'HPS Over Time'
    : metric === 'deaths' ? 'Deaths Over Time'
    : 'Interrupts Over Time'

  // Canvas CSS-pixel x (relative to canvas left edge) of a mouse event.
  // Clamped so a drag that escapes the plot still produces a usable selection.
  function canvasXFromEvent(e: MouseEvent | React.MouseEvent, rect: DOMRect): number {
    return Math.max(PAD.left, Math.min(rect.width - PAD.right, e.clientX - rect.left))
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    // Guard: inactive graph, non-line graphs, Summary mode, and empty data
    // all skip drag. Only primary button starts a selection; other buttons
    // pass through so right-click menus still work.
    if (!dragEnabled || !lineData || e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xInPlot = e.clientX - rect.left - PAD.left
    const plotW = rect.width - PAD.left - PAD.right
    if (xInPlot < 0 || xInPlot > plotW) return

    const xCss = canvasXFromEvent(e, rect)
    setDrag({ startX: xCss, currentX: xCss })
    // Clear hover so the crosshair doesn't flash during the drag; the draw()
    // branch suppresses it via `drag` anyway, but clearing keeps state tidy.
    if (hover) setHover(null)
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (inactive) return
    const rect = e.currentTarget.getBoundingClientRect()
    const plotW = rect.width - PAD.left - PAD.right
    const xInPlot = e.clientX - rect.left - PAD.left

    // Active drag: extend the selection. The window-level mouseup listener
    // below handles commit/discard when the button is released.
    if (drag) {
      const xCss = canvasXFromEvent(e, rect)
      if (xCss !== drag.currentX) setDrag({ startX: drag.startX, currentX: xCss })
      return
    }

    if (lineData) {
      if (xInPlot < 0 || xInPlot > plotW) {
        if (hover) setHover(null)
        return
      }
      const slice = Math.max(0, Math.min(lineData.points, Math.round((xInPlot / plotW) * lineData.points)))
      const anchorX = PAD.left + (slice / lineData.points) * plotW
      if (!hover || hover.slice !== slice) setHover({ slice, xCss: anchorX })
      return
    }

    if (barData) {
      if (xInPlot < 0 || xInPlot > plotW) {
        if (barHover) setBarHover(null)
        return
      }
      const groupW = plotW / barData.bucketCount
      const bucket = Math.min(barData.bucketCount - 1, Math.max(0, Math.floor(xInPlot / groupW)))
      if (barData.bucketRecords[bucket].length === 0) {
        if (barHover) setBarHover(null)
        return
      }

      // Within the hovered bucket, snap to the closest drawn bar (player series
      // with non-zero count in this bucket). Mirrors drawBars' layout math so
      // the hit point lines up with what's on screen, including the 2-px min
      // bar width used when many players fit into a cluster.
      const nSeries = barData.series.length
      const groupPad = Math.max(1, groupW * 0.15)
      const usableW = groupW - groupPad * 2
      const barW = Math.max(2, usableW / nSeries)
      const barGap = nSeries > 1 ? Math.max(1, (usableW - barW * nSeries) / (nSeries - 1)) : 0
      const groupX = bucket * groupW + groupPad

      let bestPi = -1
      let bestDist = Infinity
      for (let pi = 0; pi < nSeries; pi++) {
        if (barData.series[pi].buckets[bucket] === 0) continue
        const cx = groupX + pi * (barW + barGap) + barW / 2
        const d = Math.abs(xInPlot - cx)
        if (d < bestDist) { bestDist = d; bestPi = pi }
      }
      if (bestPi === -1) {
        if (barHover) setBarHover(null)
        return
      }

      const anchorX = PAD.left + groupX + bestPi * (barW + barGap) + barW / 2
      if (!barHover || barHover.bucket !== bucket || barHover.seriesIndex !== bestPi) {
        setBarHover({ bucket, seriesIndex: bestPi, xCss: anchorX })
      }
    }
  }

  function handleMouseLeave() {
    if (hover) setHover(null)
    if (barHover) setBarHover(null)
  }

  // Tooltip content — only focused series plus group avg when focused.
  const tooltip = hover && lineData ? (() => {
    const rows: { label: string; color: string; value: number }[] = []
    lineData.series.forEach(s => {
      if (focused.has(s.name)) {
        rows.push({ label: s.displayName, color: s.color, value: s.data[hover.slice] })
      }
    })
    if (focused.has(GRAPH_GROUP_AVG_KEY)) {
      rows.push({ label: 'Group Avg', color: GROUP_AVG_COLOR, value: lineData.avgData[hover.slice] })
    }
    rows.sort((a, b) => b.value - a.value)
    const seconds = Math.round(timeOffset + hover.slice * lineData.bucketSec)
    return { rows, timeLabel: formatTime(seconds) }
  })() : null

  const barTooltip = barHover && barData
    ? barData.bucketRecords[barHover.bucket]
        .filter(r => r.playerName === barData.series[barHover.seriesIndex].playerName)
    : null

  // Position tooltip on the opposite side of the cursor when it would crowd
  // the right edge. Measured against container width rather than canvas to
  // match the wrapper's absolute positioning context.
  const canvasCssW = canvasRef.current?.offsetWidth ?? 0
  const activeXCss = tooltip ? hover!.xCss : barTooltip ? barHover!.xCss : 0
  const flipLeft = (tooltip || barTooltip) && canvasCssW > 0 && activeXCss > canvasCssW * 0.6

  return (
    <div
      ref={containerRef}
      style={{
        flexShrink: 0,
        padding: '8px 16px 4px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{
          fontSize: 10, fontWeight: 500, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: 'var(--text-muted)',
        }}>
          {title}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {!inactive && legendEntries.map(e => {
            const isFocused = isBar || focused.has(e.key)
            return (
              <div
                key={e.key}
                onClick={isBar ? undefined : () => toggleFocus(e.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 10,
                  color: 'var(--text-secondary)',
                  opacity: isFocused ? 1 : UNFOCUSED_ALPHA + 0.22,
                  cursor: isBar ? 'default' : 'pointer',
                  userSelect: 'none',
                  transition: 'opacity 120ms ease',
                }}
              >
                <div style={{
                  width: 8, height: isBar ? 6 : 2,
                  background: e.color, borderRadius: 1,
                }} />
                {e.label}
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{
            width: '100%',
            height: 120,
            display: 'block',
            // Crosshair only when drag-select is actually available — it
            // signals a distinct affordance, so we don't want to imply it in
            // Summary mode, on bar metrics, or over inactive/empty graphs.
            cursor: dragEnabled && lineData ? 'crosshair' : 'default',
            // Prevent the browser's default text-selection-on-drag from
            // highlighting legend/title text during a range selection.
            userSelect: drag ? 'none' : 'auto',
          }}
        />
        {tooltip && hover && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: hover.xCss,
              transform: flipLeft ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
              pointerEvents: 'none',
              background: 'rgba(16,17,20,0.94)',
              border: '1px solid var(--border-default)',
              padding: '8px 10px',
              fontSize: 12,
              minWidth: 130,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              zIndex: 2,
            }}
          >
            <div style={{
              fontFamily: 'var(--font-mono)',
              color: '#a8aab4',
              marginBottom: tooltip.rows.length > 0 ? 4 : 0,
            }}>
              {tooltip.timeLabel}
            </div>
            {tooltip.rows.map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: r.color }}>
                <span>{r.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatNum(Math.round(r.value))}</span>
              </div>
            ))}
          </div>
        )}
        {barTooltip && barHover && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: barHover.xCss,
              transform: flipLeft ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
              pointerEvents: 'none',
              background: 'rgba(16,17,20,0.94)',
              border: '1px solid var(--border-default)',
              padding: '8px 10px',
              fontSize: 12,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              zIndex: 2,
            }}
          >
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'auto auto auto auto',
              columnGap: 10,
              rowGap: 2,
              alignItems: 'baseline',
            }}>
              {barTooltip.map((r, i) => (
                <BarTooltipRowView key={i} row={r} timeOffset={timeOffset} metric={metric as 'deaths' | 'interrupts'} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function BarTooltipRowView({
  row,
  timeOffset,
  metric,
}: {
  row: BarTooltipRow
  timeOffset: number
  metric: 'deaths' | 'interrupts'
}) {
  const time = formatTime(Math.round(timeOffset + row.combatElapsed))
  const isDeath = metric === 'deaths'
  const ability = isDeath ? row.killingSpellName : row.kickedSpellName
  const target = isDeath ? row.sourceName : row.targetName
  return (
    <>
      <span style={{ fontFamily: 'var(--font-mono)', color: '#a8aab4' }}>{time}</span>
      <span style={{ color: row.color }}>{shortName(row.playerName)}</span>
      <span style={{ color: 'var(--text-primary)' }}>{ability ?? '—'}</span>
      <span style={{ color: '#a8aab4' }}>{target ?? '—'}</span>
    </>
  )
}

interface LegendEntry { key: string; label: string; color: string }

function buildLegend(
  playerList: PlayerSnapshot[],
  playerSpecs: Record<string, number>,
  metric: 'damage' | 'healing' | 'deaths' | 'interrupts',
  isBar: boolean,
): LegendEntry[] {
  const entries: LegendEntry[] = []

  if (isBar) {
    const valFn = metric === 'deaths'
      ? (p: PlayerSnapshot) => p.deaths.length
      : (p: PlayerSnapshot) => p.interrupts.total
    const active = [...playerList].filter(p => valFn(p) > 0).sort((a, b) => valFn(b) - valFn(a))
    active.forEach(p => {
      const specId = resolveSpecId(playerSpecs, p.name, p.specId)
      entries.push({ key: p.name, label: shortName(p.name), color: getClassColor(specId) })
    })
  } else {
    const rateFn = metric === 'damage' ? (p: PlayerSnapshot) => p.dps : (p: PlayerSnapshot) => p.hps
    const sorted = [...playerList].sort((a, b) => rateFn(b) - rateFn(a)).slice(0, 5)
    sorted.forEach(p => {
      const specId = resolveSpecId(playerSpecs, p.name, p.specId)
      entries.push({ key: p.name, label: shortName(p.name), color: getClassColor(specId) })
    })
    entries.push({ key: GRAPH_GROUP_AVG_KEY, label: 'Group Avg', color: 'var(--data-group-avg)' })
  }

  return entries
}

function drawLineGraph(
  ctx: CanvasRenderingContext2D,
  h: number,
  plotW: number, plotH: number,
  lineData: LineData,
  focused: Set<string>,
  duration: number,
  timeOffset: number,
  hoverSlice: number | null,
) {
  const { series, avgData, points, maxVal } = lineData

  // Grid lines
  drawGrid(ctx, plotW, plotH, 4)

  // Y-axis labels
  ctx.fillStyle = '#a8aab4'
  ctx.font = MONO_FONT
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + plotH * (1 - i / 4)
    ctx.fillText(formatNum(Math.round(maxVal * i / 4)), PAD.left - 4, y + 3)
  }

  // X-axis labels
  drawXLabels(ctx, h, plotW, duration, 6, timeOffset)

  const xOf = (i: number) => PAD.left + (i / points) * plotW
  const yOf = (v: number) => PAD.top + plotH * (1 - v / maxVal)

  // Group average (solid amber with gradient fill) — drawn first so player lines sit on top.
  const avgFocused = focused.has(GRAPH_GROUP_AVG_KEY)
  const avgAlpha = avgFocused ? 0.9 : UNFOCUSED_ALPHA
  const tracePath = () => {
    ctx.beginPath()
    ctx.moveTo(xOf(0), yOf(avgData[0]))
    for (let i = 1; i <= points; i++) {
      const x0 = xOf(i - 1), y0 = yOf(avgData[i - 1])
      const x1 = xOf(i), y1 = yOf(avgData[i])
      const cpx = (x0 + x1) / 2
      ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1)
    }
  }

  const gradient = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH)
  gradient.addColorStop(0, `rgba(245, 158, 11, ${0.22 * avgAlpha})`)
  gradient.addColorStop(1, 'rgba(245, 158, 11, 0)')
  ctx.fillStyle = gradient
  tracePath()
  ctx.lineTo(xOf(points), PAD.top + plotH)
  ctx.lineTo(xOf(0), PAD.top + plotH)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = GROUP_AVG_COLOR
  ctx.lineWidth = 2
  ctx.globalAlpha = avgAlpha
  tracePath()
  ctx.stroke()
  ctx.globalAlpha = 1

  // Player lines (smooth cubic bezier). Draw unfocused first so focused lines sit on top.
  const ordered = series
    .map(s => ({ ...s, focused: focused.has(s.name) }))
    .sort((a, b) => Number(a.focused) - Number(b.focused))

  ordered.forEach(s => {
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.5
    ctx.globalAlpha = s.focused ? 0.8 : UNFOCUSED_ALPHA
    ctx.beginPath()
    ctx.moveTo(xOf(0), yOf(s.data[0]))
    for (let i = 1; i <= points; i++) {
      const x0 = xOf(i - 1), y0 = yOf(s.data[i - 1])
      const x1 = xOf(i), y1 = yOf(s.data[i])
      const cpx = (x0 + x1) / 2
      ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  })

  // Hover marker: thin vertical line + dots on each focused series at the slice.
  if (hoverSlice !== null) {
    const hx = xOf(hoverSlice)
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(hx, PAD.top)
    ctx.lineTo(hx, PAD.top + plotH)
    ctx.stroke()

    series.forEach(s => {
      if (!focused.has(s.name)) return
      const y = yOf(s.data[hoverSlice])
      drawDot(ctx, hx, y, s.color)
    })
    if (avgFocused) {
      drawDot(ctx, hx, yOf(avgData[hoverSlice]), GROUP_AVG_COLOR)
    }
  }
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color
  ctx.strokeStyle = 'rgba(16,17,20,0.9)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(x, y, 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

// Live drag rectangle drawn during a drag-select. Coordinates come from state
// in canvas-CSS pixels (relative to the canvas left edge, not the plot area),
// and are clamped to the plot bounds here so the overlay never bleeds into the
// y-axis label gutter or the x-axis label strip.
function drawDragRect(
  ctx: CanvasRenderingContext2D,
  plotW: number,
  plotH: number,
  drag: { startX: number; currentX: number },
) {
  const plotLeft = PAD.left
  const plotRight = PAD.left + plotW
  const x0 = Math.max(plotLeft, Math.min(plotRight, Math.min(drag.startX, drag.currentX)))
  const x1 = Math.max(plotLeft, Math.min(plotRight, Math.max(drag.startX, drag.currentX)))
  const width = x1 - x0
  if (width <= 0) return

  ctx.fillStyle = TIME_WINDOW_FILL
  ctx.fillRect(x0, PAD.top, width, plotH)
  ctx.strokeStyle = TIME_WINDOW_BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x0 + 0.5, PAD.top)
  ctx.lineTo(x0 + 0.5, PAD.top + plotH)
  ctx.moveTo(x1 - 0.5, PAD.top)
  ctx.lineTo(x1 - 0.5, PAD.top + plotH)
  ctx.stroke()
}

// Committed TimeWindow indicator: dim the regions OUTSIDE [startSec, endSec]
// so the selected band stays bright and fully visible. Rendered on top of the
// line graph but under the hover tooltip.
function shadeOutsideWindow(
  ctx: CanvasRenderingContext2D,
  plotW: number,
  plotH: number,
  duration: number,
  startSec: number,
  endSec: number,
) {
  if (duration <= 0) return
  const startX = PAD.left + (Math.max(0, startSec) / duration) * plotW
  const endX = PAD.left + (Math.min(duration, endSec) / duration) * plotW
  if (endX <= startX) return

  ctx.fillStyle = TIME_WINDOW_SHADE
  // Left of window
  if (startX > PAD.left) {
    ctx.fillRect(PAD.left, PAD.top, startX - PAD.left, plotH)
  }
  // Right of window
  const plotRight = PAD.left + plotW
  if (endX < plotRight) {
    ctx.fillRect(endX, PAD.top, plotRight - endX, plotH)
  }

  // Subtle border markers at the window edges so the band is legible even when
  // the graph underneath is mostly flat.
  ctx.strokeStyle = TIME_WINDOW_BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(startX + 0.5, PAD.top)
  ctx.lineTo(startX + 0.5, PAD.top + plotH)
  ctx.moveTo(endX - 0.5, PAD.top)
  ctx.lineTo(endX - 0.5, PAD.top + plotH)
  ctx.stroke()
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  h: number,
  plotW: number, plotH: number,
  barData: BarData,
  timeOffset: number,
  hoverBucket: number | null,
  hoverSeriesIndex: number | null,
) {
  const { series: data, bucketCount, bucketSec } = barData
  // Find max
  let maxBucket = 0
  for (let b = 0; b < bucketCount; b++) {
    data.forEach(d => { if (d.buckets[b] > maxBucket) maxBucket = d.buckets[b] })
  }
  maxBucket = Math.max(maxBucket, 1)

  const ySteps = Math.min(maxBucket, 4)

  // Grid
  drawGrid(ctx, plotW, plotH, ySteps)

  // Y labels
  ctx.fillStyle = '#a8aab4'
  ctx.font = MONO_FONT
  ctx.textAlign = 'right'
  for (let i = 0; i <= ySteps; i++) {
    const y = PAD.top + plotH * (1 - i / ySteps)
    ctx.fillText(String(Math.round(maxBucket * i / ySteps)), PAD.left - 4, y + 3)
  }

  // X labels — offset added so M+ subcategory bars align with the dungeon timeline.
  ctx.textAlign = 'center'
  const labelEvery = bucketCount <= 12 ? 1 : Math.ceil(bucketCount / 8)
  for (let b = 0; b < bucketCount; b += labelEvery) {
    const sec = Math.round(timeOffset + b * bucketSec)
    const x = PAD.left + (b + 0.5) * (plotW / bucketCount)
    ctx.fillText(formatTime(sec), x, h - 2)
  }

  // Bars
  const groupW = plotW / bucketCount
  const groupPad = Math.max(1, groupW * 0.15)
  const usableW = groupW - groupPad * 2
  const barW = Math.max(2, usableW / data.length)
  const barGap = data.length > 1 ? Math.max(1, (usableW - barW * data.length) / (data.length - 1)) : 0

  // Hover highlight — a single bar wide, so only the hovered player's bar in
  // the hovered bucket is lit (not neighbours in the same cluster).
  if (hoverBucket !== null && hoverSeriesIndex !== null) {
    const groupX = PAD.left + hoverBucket * groupW + groupPad
    const x0 = groupX + hoverSeriesIndex * (barW + barGap)
    const highlightPad = 2
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(x0 - highlightPad, PAD.top, barW + highlightPad * 2, plotH)
  }

  for (let b = 0; b < bucketCount; b++) {
    const groupX = PAD.left + b * groupW + groupPad
    data.forEach((d, pi) => {
      const val = d.buckets[b]
      if (val === 0) return
      const barH = (val / maxBucket) * plotH
      const x = groupX + pi * (barW + barGap)
      const y = PAD.top + plotH - barH

      ctx.fillStyle = d.color
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      ctx.roundRect(x, y, barW, barH, [1, 1, 0, 0])
      ctx.fill()
      ctx.globalAlpha = 1
    })
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, plotW: number, plotH: number, steps: number) {
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'
  ctx.lineWidth = 1
  for (let i = 0; i <= steps; i++) {
    const y = PAD.top + plotH * (1 - i / steps)
    ctx.beginPath()
    ctx.moveTo(PAD.left, y)
    ctx.lineTo(PAD.left + plotW, y)
    ctx.stroke()
  }
}

function drawXLabels(
  ctx: CanvasRenderingContext2D,
  h: number,
  plotW: number,
  duration: number,
  count: number,
  offset: number = 0,
) {
  ctx.fillStyle = '#a8aab4'
  ctx.font = MONO_FONT
  ctx.textAlign = 'center'
  for (let i = 0; i <= count; i++) {
    const x = PAD.left + plotW * i / count
    const sec = Math.round(offset + duration * i / count)
    ctx.fillText(formatTime(sec), x, h - 2)
  }
}

function drawEmptyState(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#a8aab4'
  ctx.font = SANS_FONT
  ctx.textAlign = 'center'
  ctx.fillText('None', w / 2, h / 2 + 4)
}

function drawInactiveState(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const plotW = w - PAD.left - PAD.right
  const plotH = h - PAD.top - PAD.bottom

  // Faint grid lines — same structure as active graph but much subtler.
  ctx.strokeStyle = 'rgba(255,255,255,0.025)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + plotH * (1 - i / 4)
    ctx.beginPath()
    ctx.moveTo(PAD.left, y)
    ctx.lineTo(PAD.left + plotW, y)
    ctx.stroke()
  }

  // Decorative sine wave — gives visual rhythm without implying real data.
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  const mid = PAD.top + plotH * 0.5
  const amp = plotH * 0.18
  for (let x = 0; x <= plotW; x++) {
    const t = x / plotW
    const y = mid - Math.sin(t * Math.PI * 2.5) * amp * (0.5 + 0.5 * Math.sin(t * Math.PI))
    if (x === 0) ctx.moveTo(PAD.left + x, y)
    else ctx.lineTo(PAD.left + x, y)
  }
  ctx.stroke()

  // Label
  ctx.fillStyle = 'rgba(168,170,180,0.45)'
  ctx.font = SANS_FONT
  ctx.textAlign = 'center'
  ctx.fillText('Select a segment to view graph', w / 2, PAD.top + plotH * 0.72)
}

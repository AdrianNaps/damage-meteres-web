import { useRef, useEffect, useCallback } from 'react'
import type { PlayerSnapshot, PlayerDeathRecord } from '../types'
import { getClassColor } from './PlayerRow'
import { useStore, resolveSpecId } from '../store'
import { formatNum, shortName } from '../utils/format'

interface Props {
  metric: 'damage' | 'healing' | 'deaths' | 'interrupts'
  players: Record<string, PlayerSnapshot>
  duration: number
}

const PAD = { top: 4, right: 8, bottom: 16, left: 40 }

function hashStr(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
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

export function GraphContainer({ metric, players, duration }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const playerSpecs = useStore(s => s.playerSpecs)

  const playerList = Object.values(players)

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

    const plotW = w - PAD.left - PAD.right
    const plotH = h - PAD.top - PAD.bottom

    if (metric === 'deaths' || metric === 'interrupts') {
      drawBarGraph(ctx, w, h, plotW, plotH, playerList, playerSpecs, metric, duration)
    } else {
      drawLineGraph(ctx, w, h, plotW, plotH, playerList, playerSpecs, metric, duration)
    }
  }, [metric, playerList, playerSpecs, duration])

  useEffect(() => {
    draw()
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(container)
    return () => ro.disconnect()
  }, [draw])

  // Build legend data
  const isBar = metric === 'deaths' || metric === 'interrupts'
  const legendEntries = buildLegend(playerList, playerSpecs, metric, isBar)

  const title = metric === 'damage' ? 'DPS Over Time'
    : metric === 'healing' ? 'HPS Over Time'
    : metric === 'deaths' ? 'Deaths Over Time'
    : 'Interrupts Over Time'

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
          {legendEntries.map(e => (
            <div key={e.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-secondary)' }}>
              <div style={{
                width: 8, height: e.dashed ? 2 : (isBar ? 6 : 2),
                background: e.color, borderRadius: 1,
                ...(e.dashed ? { borderTop: `1px dashed ${e.color}`, background: 'transparent' } : {}),
              }} />
              {e.label}
            </div>
          ))}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 120, display: 'block' }}
      />
    </div>
  )
}

interface LegendEntry { label: string; color: string; dashed?: boolean }

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
      entries.push({ label: shortName(p.name), color: getClassColor(specId) })
    })
  } else {
    const rateFn = metric === 'damage' ? (p: PlayerSnapshot) => p.dps : (p: PlayerSnapshot) => p.hps
    const sorted = [...playerList].sort((a, b) => rateFn(b) - rateFn(a)).slice(0, 5)
    sorted.forEach(p => {
      const specId = resolveSpecId(playerSpecs, p.name, p.specId)
      entries.push({ label: shortName(p.name), color: getClassColor(specId) })
    })
    entries.push({ label: 'Group Avg', color: 'var(--data-group-avg)', dashed: true })
  }

  return entries
}

function drawLineGraph(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  plotW: number, plotH: number,
  playerList: PlayerSnapshot[],
  playerSpecs: Record<string, number>,
  metric: 'damage' | 'healing',
  duration: number,
) {
  const rateFn = metric === 'damage' ? (p: PlayerSnapshot) => p.dps : (p: PlayerSnapshot) => p.hps
  const sorted = [...playerList].sort((a, b) => rateFn(b) - rateFn(a)).slice(0, 5)

  if (sorted.length === 0 || rateFn(sorted[0]) === 0) {
    drawEmptyState(ctx, w, h)
    return
  }

  const points = 60

  // Generate series data
  const series = sorted.map(p => {
    const specId = resolveSpecId(playerSpecs, p.name, p.specId)
    return {
      data: generateSeries(rateFn(p), p.name, points),
      color: getClassColor(specId),
    }
  })

  // Find max
  let maxVal = 0
  series.forEach(s => s.data.forEach(v => { if (v > maxVal) maxVal = v }))
  maxVal *= 1.1

  // Grid lines
  drawGrid(ctx, plotW, plotH, 4)

  // Y-axis labels
  const monoFont = '9px var(--font-mono)'
  ctx.fillStyle = '#55565e'
  ctx.font = monoFont
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + plotH * (1 - i / 4)
    ctx.fillText(formatNum(Math.round(maxVal * i / 4)), PAD.left - 4, y + 3)
  }

  // X-axis labels
  drawXLabels(ctx, h, plotW, duration, 6)

  // Player lines (smooth cubic bezier)
  series.forEach(s => {
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.5
    ctx.globalAlpha = 0.8
    ctx.beginPath()
    const pts = s.data.map((v, i) => ({
      x: PAD.left + (i / points) * plotW,
      y: PAD.top + plotH * (1 - v / maxVal),
    }))
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) {
      const cpx = (pts[i - 1].x + pts[i].x) / 2
      ctx.bezierCurveTo(cpx, pts[i - 1].y, cpx, pts[i].y, pts[i].x, pts[i].y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  })

  // Group average (dashed amber)
  const avgData: number[] = []
  for (let i = 0; i <= points; i++) {
    let sum = 0
    series.forEach(s => { sum += s.data[i] })
    avgData.push(sum / series.length)
  }
  const avgPts = avgData.map((v, i) => ({
    x: PAD.left + (i / points) * plotW,
    y: PAD.top + plotH * (1 - v / maxVal),
  }))
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = 2
  ctx.globalAlpha = 0.9
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(avgPts[0].x, avgPts[0].y)
  for (let i = 1; i < avgPts.length; i++) {
    const cpx = (avgPts[i - 1].x + avgPts[i].x) / 2
    ctx.bezierCurveTo(cpx, avgPts[i - 1].y, cpx, avgPts[i].y, avgPts[i].x, avgPts[i].y)
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1
}

function drawBarGraph(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  plotW: number, plotH: number,
  playerList: PlayerSnapshot[],
  playerSpecs: Record<string, number>,
  metric: 'deaths' | 'interrupts',
  duration: number,
) {
  const isDeath = metric === 'deaths'

  if (isDeath) {
    // Deaths have real timestamps — bucket by combatElapsed
    const allDeaths: { record: PlayerDeathRecord; specId?: number }[] = []
    playerList.forEach(p => {
      const specId = resolveSpecId(playerSpecs, p.name, p.specId)
      p.deaths.forEach(d => allDeaths.push({ record: d, specId }))
    })

    if (allDeaths.length === 0) {
      drawEmptyState(ctx, w, h)
      return
    }

    const bucketSec = duration > 400 ? 60 : 30
    const bucketCount = Math.max(1, Math.ceil(duration / bucketSec))

    // Group deaths by player within buckets
    const playerMap = new Map<string, { color: string; buckets: number[] }>()
    allDeaths.forEach(({ record, specId }) => {
      const name = record.playerName
      if (!playerMap.has(name)) {
        playerMap.set(name, {
          color: getClassColor(specId),
          buckets: new Array(bucketCount).fill(0),
        })
      }
      const bucket = Math.min(Math.floor(record.combatElapsed / bucketSec), bucketCount - 1)
      playerMap.get(name)!.buckets[bucket]++
    })

    const activePlayers = [...playerMap.entries()]
      .sort((a, b) => b[1].buckets.reduce((s, v) => s + v, 0) - a[1].buckets.reduce((s, v) => s + v, 0))

    drawBars(ctx, w, h, plotW, plotH, activePlayers.map(([, v]) => v), bucketCount, bucketSec, duration)
  } else {
    // Interrupts: no timestamps available, generate synthetic bucketed data
    const valFn = (p: PlayerSnapshot) => p.interrupts.total
    const active = [...playerList].filter(p => valFn(p) > 0).sort((a, b) => valFn(b) - valFn(a))

    if (active.length === 0) {
      drawEmptyState(ctx, w, h)
      return
    }

    const bucketSec = duration > 400 ? 60 : 30
    const bucketCount = Math.max(1, Math.ceil(duration / bucketSec))

    const bucketData = active.map(p => {
      const total = valFn(p)
      const buckets = new Array(bucketCount).fill(0)
      let seed = hashStr(p.name + 'interrupts')
      for (let i = 0; i < total; i++) {
        seed = (seed * 16807 + 12345) & 0x7fffffff
        buckets[seed % bucketCount]++
      }
      const specId = resolveSpecId(playerSpecs, p.name, p.specId)
      return { color: getClassColor(specId), buckets }
    })

    drawBars(ctx, w, h, plotW, plotH, bucketData, bucketCount, bucketSec, duration)
  }
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  plotW: number, plotH: number,
  data: { color: string; buckets: number[] }[],
  bucketCount: number,
  bucketSec: number,
  duration: number,
) {
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
  const monoFont = '9px var(--font-mono)'
  ctx.fillStyle = '#55565e'
  ctx.font = monoFont
  ctx.textAlign = 'right'
  for (let i = 0; i <= ySteps; i++) {
    const y = PAD.top + plotH * (1 - i / ySteps)
    ctx.fillText(String(Math.round(maxBucket * i / ySteps)), PAD.left - 4, y + 3)
  }

  // X labels
  ctx.textAlign = 'center'
  const labelEvery = bucketCount <= 12 ? 1 : Math.ceil(bucketCount / 8)
  for (let b = 0; b < bucketCount; b += labelEvery) {
    const sec = b * bucketSec
    const x = PAD.left + (b + 0.5) * (plotW / bucketCount)
    ctx.fillText(formatTime(sec), x, h - 2)
  }

  // Bars
  const groupW = plotW / bucketCount
  const groupPad = Math.max(1, groupW * 0.15)
  const usableW = groupW - groupPad * 2
  const barW = Math.max(2, usableW / data.length)
  const barGap = data.length > 1 ? Math.max(1, (usableW - barW * data.length) / (data.length - 1)) : 0

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

function drawXLabels(ctx: CanvasRenderingContext2D, h: number, plotW: number, duration: number, count: number) {
  ctx.fillStyle = '#55565e'
  ctx.font = '9px var(--font-mono)'
  ctx.textAlign = 'center'
  for (let i = 0; i <= count; i++) {
    const x = PAD.left + plotW * i / count
    const sec = Math.round(duration * i / count)
    ctx.fillText(formatTime(sec), x, h - 2)
  }
}

function drawEmptyState(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#55565e'
  ctx.font = '11px var(--font-sans)'
  ctx.textAlign = 'center'
  ctx.fillText('None', w / 2, h / 2 + 4)
}

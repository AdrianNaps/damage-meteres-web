import { useMemo } from 'react'
import { useStore } from '../store'
import { spellIconUrl } from '../utils/icons'
import type { ClientEvent } from '../types'

// Horizontal timeline for the Casts drill. One lane per spell, sorted by
// completed-cast count descending. Each cast is rendered as a shape that
// encodes its kind (instant / hardcast / channel) and result (completed /
// cancelled). Shares the class color + same Ability filter as CastSpellTable
// so toggling between the two views keeps the visible set consistent.

const PX_PER_SEC = 32
const GUTTER_W = 58
const LANE_H = 32

interface Props {
  events: ClientEvent[]
  playerName: string
  duration: number
  classColor: string
}

interface Cast {
  // Seconds from scope start.
  t: number
  kind: 'instant' | 'hardcast' | 'channel'
  // Cast/channel duration in seconds (0 for instant).
  ms: number
  result: 'completed' | 'cancelled'
  cancelReason?: 'interrupted' | 'movement' | 'stunned'
}

interface Lane {
  spellId: string
  spellName: string
  casts: Cast[]
  completedCount: number
  cancelledCount: number
}

export function CastTimelineView({ events, playerName, duration, classColor }: Props) {
  const filterValues = useStore(s => s.filters.Ability)
  const spellIcons = useStore(s => s.spellIcons)

  const lanes = useMemo<Lane[]>(() => {
    if (events.length === 0) return []
    const t0 = events[0].t
    const byKey = new Map<string, Lane>()
    for (const e of events) {
      if (e.kind !== 'cast' || e.src !== playerName) continue
      const spellId = e.spellId ?? ''
      const key = spellId || e.ability
      let lane = byKey.get(key)
      if (!lane) {
        lane = { spellId, spellName: e.ability, casts: [], completedCount: 0, cancelledCount: 0 }
        byKey.set(key, lane)
      }
      const result = e.castResult ?? 'completed'
      lane.casts.push({
        t: (e.t - t0) / 1000,
        kind: e.castKind ?? 'instant',
        ms: e.castMs ?? 0,
        result,
        cancelReason: e.cancelReason,
      })
      if (result === 'cancelled') lane.cancelledCount++
      else lane.completedCount++
    }
    // Sort by completed count desc; ties go to total event count desc.
    return [...byKey.values()].sort((a, b) => {
      if (b.completedCount !== a.completedCount) return b.completedCount - a.completedCount
      return b.casts.length - a.casts.length
    })
  }, [events, playerName])

  const visibleLanes = filterValues
    ? lanes.filter(l => filterValues.includes(l.spellName))
    : lanes

  if (visibleLanes.length === 0) {
    return (
      <div className="cast-timeline-empty">
        {filterValues ? 'No casts match the current filter.' : 'No cast data.'}
      </div>
    )
  }

  const dur = Math.max(1, duration)
  const trackWidth = Math.round(dur * PX_PER_SEC)
  const scaleWidth = GUTTER_W + trackWidth

  // Axis ticks: minor every 5s, major every 15s (labelled). At 16 px/sec a
  // 15s segment is 240px wide — enough room for a "0:15"-style label without
  // crowding. Very short fights (<10s) fall back to 1s minor / 5s major so
  // the axis still has structure.
  const minorStep = dur < 10 ? 1 : 5
  const majorStep = dur < 10 ? 5 : 15
  const ticks: { x: number; label: string | null }[] = []
  for (let t = 0; t <= dur; t += minorStep) {
    const isMajor = t % majorStep === 0
    ticks.push({ x: t * PX_PER_SEC, label: isMajor ? formatMMSS(t) : null })
  }

  return (
    <div
      className="cast-timeline"
      style={{ ['--cast-timeline-accent' as string]: classColor }}
    >
      <div className="cast-timeline-scroll">
        <div className="cast-timeline-scale" style={{ width: scaleWidth }}>
          {/* Sticky axis */}
          <div
            className="cast-timeline-axis"
            style={{ gridTemplateColumns: `${GUTTER_W}px 1fr` }}
          >
            <div className="cast-timeline-axis-gutter" />
            <div className="cast-timeline-axis-track">
              {ticks.map((tick, i) => (
                <div
                  key={i}
                  className={`cast-timeline-axis-tick${tick.label !== null ? ' major' : ''}`}
                  style={{ left: tick.x }}
                />
              ))}
              {ticks
                .filter(t => t.label !== null)
                .map((tick, i) => (
                  <div
                    key={`l-${i}`}
                    className="cast-timeline-axis-label"
                    style={{ left: tick.x }}
                  >
                    {tick.label}
                  </div>
                ))}
            </div>
          </div>

          {/* Lanes */}
          {visibleLanes.map(lane => (
            <CastTimelineLane
              key={lane.spellId || lane.spellName}
              lane={lane}
              classColor={classColor}
              iconName={spellIcons[lane.spellId]}
              gutterW={GUTTER_W}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function CastTimelineLane({
  lane,
  classColor,
  iconName,
  gutterW,
}: {
  lane: Lane
  classColor: string
  iconName: string | undefined
  gutterW: number
}) {
  const iconUrl = spellIconUrl(iconName)
  // Gutter shows completed count primarily; cancelled count appended in muted
  // text when present so the discipline cost (broken hardcasts) is visible
  // without forcing the eye to count strikethroughs on the lane.
  const countLabel = lane.cancelledCount > 0
    ? `${lane.completedCount}+${lane.cancelledCount}`
    : `${lane.completedCount}`
  return (
    <div
      className="cast-timeline-lane"
      style={{ gridTemplateColumns: `${gutterW}px 1fr`, minHeight: LANE_H }}
    >
      <div className="cast-timeline-lane-gutter" title={lane.spellName}>
        <div className="cast-timeline-icon">
          {iconUrl && (
            <img
              src={iconUrl}
              alt=""
              width={20}
              height={20}
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
          )}
        </div>
        <span className="cast-timeline-count">{countLabel}</span>
      </div>
      <div className="cast-timeline-lane-track" style={{ height: LANE_H }}>
        {lane.casts.map((cast, i) => (
          <CastShape key={i} cast={cast} classColor={classColor} spellName={lane.spellName} />
        ))}
      </div>
    </div>
  )
}

function CastShape({
  cast,
  classColor,
  spellName,
}: {
  cast: Cast
  classColor: string
  spellName: string
}) {
  const x = cast.t * PX_PER_SEC

  if (cast.kind === 'instant') {
    return (
      <div
        className="cast-timeline-mark cast-timeline-mark-instant"
        style={{ left: x, background: classColor }}
        title={`${spellName} @ ${formatMMSS(cast.t)} · instant`}
      />
    )
  }

  // Hardcast or channel — width-encoded capsule. Minimum width keeps very
  // short hardcasts (< 100ms) from rendering as invisible 1px slivers.
  const width = Math.max(6, Math.round((cast.ms / 1000) * PX_PER_SEC))
  const variantClass = cast.kind === 'channel'
    ? 'cast-timeline-mark-channel'
    : cast.result === 'cancelled'
      ? `cast-timeline-mark-cancelled cast-timeline-mark-cancelled-${cast.cancelReason ?? 'interrupted'}`
      : 'cast-timeline-mark-hardcast'

  return (
    <div
      className={`cast-timeline-mark ${variantClass}`}
      style={{ left: x, width, background: classColor }}
      title={buildTooltip(spellName, cast)}
    />
  )
}

function buildTooltip(spellName: string, cast: Cast): string {
  const time = formatMMSS(cast.t)
  if (cast.kind === 'instant') return `${spellName} @ ${time} · instant`
  const seconds = (cast.ms / 1000).toFixed(2)
  if (cast.kind === 'channel') return `${spellName} @ ${time} · ${seconds}s channel`
  if (cast.result === 'cancelled') {
    const reason = cast.cancelReason ?? 'interrupted'
    return `${spellName} @ ${time} · ${seconds}s cancelled (${reason})`
  }
  return `${spellName} @ ${time} · ${seconds}s cast`
}

function formatMMSS(s: number): string {
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${ss.toString().padStart(2, '0')}`
}

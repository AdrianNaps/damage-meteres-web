import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, selectCurrentView, selectIsLoading, resolveSpecId, type Metric, type FilterState, type Perspective } from '../store'
import type { PlayerSnapshot, AuraWindowWire, BuffSection } from '../types'
import {
  computeUnitRows,
  computeDeathRows,
  computeAuraRows,
  hasMatchingData,
  hasMatchingAuraData,
  type UnitRow,
  type DeathRow,
  type AuraRow,
  type AuraKind,
} from '../utils/filters'
import { formatNum, shortName } from '../utils/format'
import { specIconUrl, spellIconUrl } from '../utils/icons'
import { getClassColor } from './PlayerRow'
import { FilterEmptyState } from './FilterEmptyState'

// Per-player table grid: rank | player | bar+% | active% | ...stats.
// Stats columns vary per category, so the grid is built dynamically.
function playerGridColumns(statCount: number): string {
  const statCols = Array.from({ length: statCount }, () => '90px').join(' ')
  return `32px 180px minmax(140px, 1fr) 70px ${statCols}`
}

// Deaths grid — per-death rows, different shape. Mirrors staging mock:
// rank | time | player | killing blow | source | overkill.
const DEATHS_GRID_COLUMNS = '32px 60px 180px minmax(140px, 1fr) 160px 90px'

type StatFormat = 'shorthand' | 'integer'
type NumericStat = { label: string; value: number; format: StatFormat; bold?: boolean; suffix?: string }

// Per-row auxiliary values threaded into config.stats — populated by
// FilteredPlayerTable's lens-aware useMemo so each config can read whichever
// it needs. Adding a new lens means adding a field here, not changing every
// config's signature. Optional so default-lens configs can ignore them.
interface AuxStats {
  overhealPerSec?: number    // healing-raw: effective + overheal = raw HPS
  mitigatedPerSec?: number   // damageTaken-mitigated: absorbed + blocked per second
  // Fight duration in seconds — threaded through so the Casts config can
  // compute CPM (casts * 60 / duration) inline without needing a second pass
  // or a new MetricConfig signature. Optional because existing configs (damage,
  // healing, damage-taken, interrupts) don't consume it.
  durationSec?: number
}

interface MetricConfig {
  labels: string[]
  stats: (row: UnitRow, aux: AuxStats) => NumericStat[]
}

const DAMAGE_CONFIG: MetricConfig = {
  labels: ['Total', 'DPS'],
  stats: r => [
    { label: 'Total', value: r.total, format: 'shorthand' },
    { label: 'DPS', value: r.value, format: 'shorthand', bold: true },
  ],
}

// Two shapes for Healing depending on the lens. Effective hides the Overheal
// column and reports effective Total / HPS. Raw reports raw Total (effective +
// overheal) and raw HPS so the three visible columns add up coherently: Total
// = Overheal + Effective contribution, and the bar (stacked effective +
// overheal) is scaled to the same raw throughput that Total and HPS display.
const HEALING_EFFECTIVE_CONFIG: MetricConfig = {
  labels: ['Total', 'HPS'],
  stats: r => [
    { label: 'Total', value: r.total, format: 'shorthand' },
    { label: 'HPS', value: r.value, format: 'shorthand', bold: true },
  ],
}

const HEALING_RAW_CONFIG: MetricConfig = {
  labels: ['Total', 'Overheal', 'HPS'],
  stats: (r, aux) => {
    const oh = r.overheal ?? 0
    const rawTotal = r.total + oh
    // Share of raw throughput that was overheal. Guard rawTotal===0 so a row
    // with zero healing doesn't render "(NaN%)".
    const ohPct = rawTotal > 0 ? (oh / rawTotal) * 100 : 0
    const rawHps = r.value + (aux.overhealPerSec ?? 0)
    return [
      { label: 'Total', value: rawTotal, format: 'shorthand' },
      { label: 'Overheal', value: oh, format: 'shorthand', suffix: rawTotal > 0 ? `(${Math.round(ohPct)}%)` : undefined },
      { label: 'HPS', value: rawHps, format: 'shorthand', bold: true },
    ]
  },
}

// Three shapes for Damage Taken, one per lens.
// Incoming (default) reports gross (landed + mitigated) Total and DTPS, plus
//   a Mitigated column with %gross suffix so the share of incoming that was
//   prevented reads at a glance. Bar stacks landed (primary fill) + mitigated
//   (lighter shade) to the same gross scale — mirrors healing-raw's effective
//   + overheal stack.
// Effective reports landed damage only — what actually hit health bars.
// Mitigated reports prevented damage only — "how much did the cooldowns eat."
const DAMAGE_TAKEN_INCOMING_CONFIG: MetricConfig = {
  labels: ['Total', 'Mitigated', 'DTPS'],
  stats: (r, aux) => {
    const mit = r.mitigated ?? 0
    const grossTotal = r.total + mit
    const mitPct = grossTotal > 0 ? (mit / grossTotal) * 100 : 0
    const grossDtps = r.value + (aux.mitigatedPerSec ?? 0)
    return [
      { label: 'Total', value: grossTotal, format: 'shorthand' },
      { label: 'Mitigated', value: mit, format: 'shorthand', suffix: grossTotal > 0 ? `(${Math.round(mitPct)}%)` : undefined },
      { label: 'DTPS', value: grossDtps, format: 'shorthand', bold: true },
    ]
  },
}

const DAMAGE_TAKEN_EFFECTIVE_CONFIG: MetricConfig = {
  labels: ['Total', 'DTPS'],
  stats: r => [
    { label: 'Total', value: r.total, format: 'shorthand' },
    { label: 'DTPS', value: r.value, format: 'shorthand', bold: true },
  ],
}

const DAMAGE_TAKEN_MITIGATED_CONFIG: MetricConfig = {
  labels: ['Mitigated', 'DTPS'],
  stats: (r, aux) => [
    { label: 'Mitigated', value: r.mitigated ?? 0, format: 'shorthand' },
    { label: 'DTPS', value: aux.mitigatedPerSec ?? 0, format: 'shorthand', bold: true },
  ],
}

// Two shapes for Interrupts depending on the lens — mirrors healing.
// Lands (default) reports landing kicks only: one bold Count column, bar
// scaled to lands. Attempts surfaces the full press count with a Missed (%)
// column and stacks lands primary + missed lighter on the bar, ranked by
// attempts. row.value is always lands; row.attempts is always presses.
const INTERRUPTS_LANDS_CONFIG: MetricConfig = {
  labels: ['Count'],
  stats: r => [
    { label: 'Count', value: r.value, format: 'integer', bold: true },
  ],
}

const INTERRUPTS_ATTEMPTS_CONFIG: MetricConfig = {
  labels: ['Attempts', 'Missed'],
  stats: r => {
    const attempts = r.attempts ?? 0
    const missed = Math.max(0, attempts - r.value)
    const missedPct = attempts > 0 ? (missed / attempts) * 100 : 0
    return [
      { label: 'Attempts', value: attempts, format: 'integer', bold: true },
      { label: 'Missed', value: missed, format: 'integer', suffix: attempts > 0 ? `(${Math.round(missedPct)}%)` : undefined },
    ]
  },
}

// Casts: primary is the raw press count (row.value is the count, not a
// rate — see computeUnitRowsImpl). CPM is derived from the fight duration
// threaded in via aux.durationSec and pre-rounded so the integer formatter
// renders a whole number even when raw CPM is fractional (e.g. 0.25).
const CASTS_CONFIG: MetricConfig = {
  labels: ['Casts', 'CPM'],
  stats: (r, aux) => {
    const dur = aux.durationSec ?? 0
    const cpm = dur > 0 ? Math.round((r.value * 60) / dur) : 0
    return [
      { label: 'Casts', value: r.value, format: 'integer', bold: true },
      { label: 'CPM', value: cpm, format: 'integer' },
    ]
  },
}

function formatStat(stat: NumericStat): string {
  if (stat.format === 'integer') return stat.value > 0 ? stat.value.toLocaleString() : '—'
  return formatNum(stat.value)
}

export function FullMeterView() {
  const currentView = useStore(selectCurrentView)
  const isLoading = useStore(selectIsLoading)
  const perspective = useStore(s => s.perspective)
  const filters = useStore(s => s.filters)
  const metric = useStore(s => s.metric)
  const selectedPlayer = useStore(s => s.selectedPlayer)
  const setSelectedPlayer = useStore(s => s.setSelectedPlayer)

  // useDeferredValue on interactive inputs so a metric/filter/perspective
  // change yields two renders: one fast with the old rows (table still shows
  // the previous state), then one that computes new rows at a lower priority.
  // Note: Zustand 5 uses useSyncExternalStore, whose updates are always
  // synchronous — so useTransition around the setters has no effect here.
  // useDeferredValue works because it shadows the value locally in React.
  const deferredPerspective = useDeferredValue(perspective)
  const deferredFilters = useDeferredValue(filters)
  const deferredMetric = useDeferredValue(metric)

  if (!currentView) {
    if (isLoading) return <FullLoadingSkeleton />
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="animate-pulse-dot" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          No encounter data
        </span>
      </div>
    )
  }

  const events = currentView.events ?? []
  const allies = currentView.players

  const duration =
    'duration' in currentView ? currentView.duration
    : 'activeDurationSec' in currentView ? currentView.activeDurationSec
    : 0

  // Aura metrics (Buffs, Debuffs) take a separate path — their row shape is
  // per-aura, not per-player, and the aura windows live in a different field
  // on the snapshot than the event stream.
  if (deferredMetric === 'buffs' || deferredMetric === 'debuffs') {
    return (
      <FilteredAurasTable
        kind={deferredMetric === 'debuffs' ? 'DEBUFF' : 'BUFF'}
        auras={currentView.auras ?? EMPTY_AURAS}
        classification={currentView.buffClassification ?? EMPTY_CLASSIFICATION}
        filters={deferredFilters}
        startTime={currentView.startTime}
        endTime={currentView.endTime}
        durationSec={duration}
        allies={allies}
        perspective={deferredPerspective}
      />
    )
  }

  const matches = hasMatchingData(events, deferredPerspective, deferredFilters, deferredMetric, allies)
  if (!matches) return <FilterEmptyState />

  if (deferredMetric === 'deaths') {
    return <FilteredDeathsTable events={events} perspective={deferredPerspective} filters={deferredFilters} allies={allies} />
  }

  return (
    <FilteredPlayerTable
      events={events}
      perspective={deferredPerspective}
      filters={deferredFilters}
      category={deferredMetric}
      allies={allies}
      duration={duration}
      selectedPlayer={selectedPlayer}
      setSelectedPlayer={setSelectedPlayer}
    />
  )
}

// Stable empty-array fallbacks so consumers reading `currentView.auras` /
// `currentView.buffClassification` when those fields are absent (legacy
// snapshots) don't thrash useMemo deps with fresh arrays every render.
const EMPTY_AURAS: AuraWindowWire[] = []
const EMPTY_CLASSIFICATION: Record<string, BuffSection> = {}

function FilteredPlayerTable({
  events,
  perspective,
  filters,
  category,
  allies,
  duration,
  selectedPlayer,
  setSelectedPlayer,
}: {
  events: Parameters<typeof computeUnitRows>[0]
  perspective: Parameters<typeof computeUnitRows>[1]
  filters: Parameters<typeof computeUnitRows>[2]
  category: 'damage' | 'damageTaken' | 'healing' | 'interrupts' | 'casts'
  allies: Record<string, PlayerSnapshot>
  duration: number
  selectedPlayer: string | null
  setSelectedPlayer: (name: string | null, drillMetric?: Metric) => void
}) {
  const playerSpecs = useStore(s => s.playerSpecs)
  const healingLens = useStore(s => s.healingLens)
  const damageTakenLens = useStore(s => s.damageTakenLens)
  const interruptsLens = useStore(s => s.interruptsLens)

  const baseRows = useMemo(
    () => computeUnitRows(events, perspective, filters, category, allies, duration),
    [events, perspective, filters, category, allies, duration]
  )

  // Resolve the active lens. 'default' = rank & bar use row.value directly
  // with no secondary stack. 'healingRaw' = bar stacks effective + overheal,
  // ranked by raw. 'damageTakenIncoming' = bar stacks landed + mitigated,
  // ranked by gross (landed + mitigated/sec). 'damageTakenMitigated' = bar
  // and ranking both swap to mitigated/sec (no stack). 'interruptsAttempts'
  // = bar stacks lands + missed, ranked by attempts (= lands + missed).
  type LensMode = 'default' | 'healingRaw' | 'damageTakenIncoming' | 'damageTakenMitigated' | 'interruptsAttempts'
  const lensMode: LensMode =
    category === 'healing' && healingLens === 'raw' ? 'healingRaw'
    : category === 'damageTaken' && damageTakenLens === 'incoming' ? 'damageTakenIncoming'
    : category === 'damageTaken' && damageTakenLens === 'mitigated' ? 'damageTakenMitigated'
    : category === 'interrupts' && interruptsLens === 'attempts' ? 'interruptsAttempts'
    : 'default'

  const config =
    category === 'damage'                 ? DAMAGE_CONFIG
    : category === 'casts'                ? CASTS_CONFIG
    : category === 'interrupts'           ? (lensMode === 'interruptsAttempts' ? INTERRUPTS_ATTEMPTS_CONFIG : INTERRUPTS_LANDS_CONFIG)
    : category === 'damageTaken'          ? (lensMode === 'damageTakenMitigated' ? DAMAGE_TAKEN_MITIGATED_CONFIG
                                            : lensMode === 'damageTakenIncoming' ? DAMAGE_TAKEN_INCOMING_CONFIG
                                            : DAMAGE_TAKEN_EFFECTIVE_CONFIG)
    : lensMode === 'healingRaw'           ? HEALING_RAW_CONFIG
    : HEALING_EFFECTIVE_CONFIG

  // Under a non-default lens we re-rank the rows and rescale the bar. Per-row
  // derived values are folded into the same useMemo so row index, scale
  // contribution, and derived numbers stay aligned. computeUnitRows stays
  // lens-agnostic so its cache key doesn't have to cover the lens dimension.
  //
  // Per-row value bundle:
  //   primaryPerSec   — bar's main fill (darker opacity)
  //   secondaryPerSec — bar's stacked lighter extension (0 = no stack)
  //   overhealPerSec  — threaded to HEALING_RAW_CONFIG.stats for raw HPS
  //   mitigatedPerSec — threaded to DAMAGE_TAKEN_{INCOMING,MITIGATED}_CONFIG
  //
  // Lens mapping:
  //   default              → primary = row.value, secondary = 0
  //   healingRaw           → primary = row.value (effective HPS),
  //                          secondary = overheal/sec; ranked by raw
  //   damageTakenIncoming  → primary = row.value (landed DTPS),
  //                          secondary = mitigated/sec; ranked by gross
  //   damageTakenMitigated → primary = mitigated/sec, secondary = 0;
  //                          ranked by mitigated
  const { rows, barScale, primaryPerSec, secondaryPerSec, overhealPerSec, mitigatedPerSec } = useMemo<{
    rows: UnitRow[]
    barScale: number
    primaryPerSec: number[]
    secondaryPerSec: number[]
    overhealPerSec: number[] | null
    mitigatedPerSec: number[] | null
  }>(() => {
    if (lensMode === 'default') {
      return {
        rows: baseRows,
        barScale: baseRows[0]?.value ?? 0,
        primaryPerSec: baseRows.map(r => r.value),
        secondaryPerSec: baseRows.map(() => 0),
        overhealPerSec: null,
        mitigatedPerSec: null,
      }
    }
    // Interrupts-attempts: primary=lands, secondary=missed, ranked by attempts.
    // Values are raw counts, no duration scaling — kept in the *PerSec arrays
    // to match the rest of the pipeline's plumbing.
    if (lensMode === 'interruptsAttempts') {
      const paired = baseRows.map(r => {
        const attempts = r.attempts ?? 0
        const missed = Math.max(0, attempts - r.value)
        return { r, attempts, missed }
      })
      paired.sort((a, b) => b.attempts - a.attempts)
      return {
        rows: paired.map(p => p.r),
        barScale: paired[0]?.attempts ?? 0,
        primaryPerSec: paired.map(p => p.r.value),
        secondaryPerSec: paired.map(p => p.missed),
        overhealPerSec: null,
        mitigatedPerSec: null,
      }
    }
    // Per-second lenses below need a non-zero duration to compute rates.
    if (duration <= 0) {
      return {
        rows: baseRows,
        barScale: baseRows[0]?.value ?? 0,
        primaryPerSec: baseRows.map(r => r.value),
        secondaryPerSec: baseRows.map(() => 0),
        overhealPerSec: null,
        mitigatedPerSec: null,
      }
    }
    if (lensMode === 'healingRaw') {
      const paired = baseRows.map(r => {
        const oh = (r.overheal ?? 0) / duration
        return { r, oh, raw: r.value + oh }
      })
      paired.sort((a, b) => b.raw - a.raw)
      return {
        rows: paired.map(p => p.r),
        barScale: paired[0]?.raw ?? 0,
        primaryPerSec: paired.map(p => p.r.value),
        secondaryPerSec: paired.map(p => p.oh),
        overhealPerSec: paired.map(p => p.oh),
        mitigatedPerSec: null,
      }
    }
    if (lensMode === 'damageTakenIncoming') {
      const paired = baseRows.map(r => {
        const mps = (r.mitigated ?? 0) / duration
        return { r, mps, gross: r.value + mps }
      })
      paired.sort((a, b) => b.gross - a.gross)
      return {
        rows: paired.map(p => p.r),
        barScale: paired[0]?.gross ?? 0,
        primaryPerSec: paired.map(p => p.r.value),
        secondaryPerSec: paired.map(p => p.mps),
        overhealPerSec: null,
        mitigatedPerSec: paired.map(p => p.mps),
      }
    }
    // damageTakenMitigated
    const paired = baseRows.map(r => {
      const mps = (r.mitigated ?? 0) / duration
      return { r, mps }
    })
    paired.sort((a, b) => b.mps - a.mps)
    return {
      rows: paired.map(p => p.r),
      barScale: paired[0]?.mps ?? 0,
      primaryPerSec: paired.map(p => p.mps),
      secondaryPerSec: paired.map(() => 0),
      overhealPerSec: null,
      mitigatedPerSec: paired.map(p => p.mps),
    }
  }, [baseRows, lensMode, duration])

  // Row total (footer share %) tracks the lens so visual dominance matches the
  // reported numbers. Sum of primary + secondary for the incoming lens (where
  // "share of gross" is the meaningful unit), sum of primary alone otherwise
  // — which is row.value under default/healingRaw and mitigated/sec under
  // damageTakenMitigated (where primary is already mitigated).
  const sumArr = (xs: number[]) => xs.reduce((s, v) => s + v, 0)
  const totalValue = (lensMode === 'damageTakenIncoming' || lensMode === 'interruptsAttempts')
    ? sumArr(primaryPerSec) + sumArr(secondaryPerSec)
    : sumArr(primaryPerSec)

  // Drill-down is supported for ally rows across all metrics, and for enemy
  // rows under damageTaken (enemy victim → spells/attackers breakdown). Other
  // enemy-perspective metrics have no aggregated snapshot on the enemy side,
  // so selecting them would render an empty breakdown.
  const drillEnabled = perspective === 'allies' || category === 'damageTaken'
  const onRowClick = useCallback(
    (name: string) => {
      if (!drillEnabled) return
      const next = selectedPlayer === name ? null : name
      setSelectedPlayer(next, next ? category : undefined)
    },
    [drillEnabled, selectedPlayer, setSelectedPlayer, category]
  )

  const rowClickable = drillEnabled

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <PlayerColumnHeader labels={config.labels} showActive={perspective === 'allies'} />
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <EmptyState text="No player data yet" />
        ) : (
          rows.map((row, i) => {
            const primary = primaryPerSec[i] ?? row.value
            const secondary = secondaryPerSec[i] ?? 0
            // Stacked-bar lenses (damageTakenIncoming, interruptsAttempts) use
            // "share of the full bar width" so the number matches what the eye
            // sees. Other lenses keep the established "share of primary"
            // convention.
            const shareNumerator = (lensMode === 'damageTakenIncoming' || lensMode === 'interruptsAttempts')
              ? primary + secondary
              : primary
            return (
              <FullPlayerRow
                key={row.name}
                row={row}
                rank={i + 1}
                barScale={barScale}
                totalValue={totalValue}
                primaryPerSec={primary}
                secondaryPerSec={secondary}
                shareNumerator={shareNumerator}
                overhealPerSec={overhealPerSec ? overhealPerSec[i] : 0}
                mitigatedPerSec={mitigatedPerSec ? mitigatedPerSec[i] : 0}
                durationSec={duration}
                activePct={perspective === 'allies' ? computeActivePct(allies[row.name], duration) : null}
                config={config}
                specId={resolveSpecId(playerSpecs, row.name, row.specId)}
                showActive={perspective === 'allies'}
                isSelected={rowClickable && selectedPlayer === row.name}
                onClick={rowClickable ? onRowClick : undefined}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

// Percentage of the fight the player was contributing. The server pre-computes
// `activeSec` per-segment so aggregated views (key run / boss section) correctly
// reactivate the player on each new pull, and within a segment we detect rezzes
// via post-death activity. See server/store.ts `segmentActiveSec`.
function computeActivePct(player: PlayerSnapshot | undefined, duration: number): number | null {
  if (!player || duration <= 0) return null
  const pct = (player.activeSec / duration) * 100
  return Math.max(0, Math.min(100, pct))
}

function PlayerColumnHeader({ labels, showActive }: { labels: string[]; showActive: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: playerGridColumns(labels.length),
        alignItems: 'center',
        gap: 12,
        padding: '6px 14px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <HeaderCell align="center">#</HeaderCell>
      <HeaderCell>Unit</HeaderCell>
      <HeaderCell />
      <HeaderCell align="right">{showActive ? 'Active' : ''}</HeaderCell>
      {labels.map((l, i) => (
        <HeaderCell key={i} align="right">{l}</HeaderCell>
      ))}
    </div>
  )
}

// Memoized so that row renders are skipped when the parent re-renders for
// unrelated reasons (e.g. an unrelated Zustand field changing). Relies on
// stable prop identity: `config` is a module-level constant, `row` is retained
// across renders via the parent's useMemo(computeUnitRows), and everything
// else is a primitive passed by value (including activePct, which is
// recomputed each render but compares equal when inputs haven't changed).
const FullPlayerRow = memo(FullPlayerRowImpl)

function FullPlayerRowImpl({
  row,
  rank,
  barScale,
  totalValue,
  primaryPerSec,
  secondaryPerSec,
  shareNumerator,
  overhealPerSec,
  mitigatedPerSec,
  durationSec,
  activePct,
  config,
  specId,
  showActive,
  isSelected,
  onClick,
}: {
  row: UnitRow
  rank: number
  barScale: number
  totalValue: number
  primaryPerSec: number     // bar's primary fill — lens-aware
  secondaryPerSec: number   // bar's stacked lighter extension (0 = no stack)
  shareNumerator: number    // numerator for the bar-cell share%
  overhealPerSec: number    // config.stats aux (healing-raw)
  mitigatedPerSec: number   // config.stats aux (damageTaken incoming/mitigated)
  durationSec: number       // config.stats aux (casts → CPM denominator)
  activePct: number | null
  config: MetricConfig
  specId: number | undefined
  showActive: boolean
  isSelected: boolean
  onClick: ((name: string) => void) | undefined
}) {
  const color = getClassColor(specId)
  const specIcon = specIconUrl(specId)

  const fillPct = barScale > 0 ? (primaryPerSec / barScale) * 100 : 0
  const secondaryPct = barScale > 0 ? (secondaryPerSec / barScale) * 100 : 0
  const shareOfTotal = totalValue > 0 ? (shareNumerator / totalValue) * 100 : 0
  const stats = config.stats(row, { overhealPerSec, mitigatedPerSec, durationSec })
  const clickable = !!onClick

  return (
    <div
      onClick={clickable ? () => onClick(row.name) : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: playerGridColumns(stats.length),
        alignItems: 'center',
        gap: 12,
        minHeight: 36,
        padding: '0 14px',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: clickable ? 'pointer' : 'default',
        background: isSelected ? 'var(--bg-active)' : 'transparent',
        transition: 'background 0.1s',
      }}
      onMouseEnter={clickable && !isSelected ? e => { e.currentTarget.style.background = 'var(--bg-hover)' } : undefined}
      onMouseLeave={clickable && !isSelected ? e => { e.currentTarget.style.background = 'transparent' } : undefined}
    >
      <RankCell rank={rank} />
      <PlayerNameCell name={row.name} color={color} specIcon={specIcon} />
      <BarCell color={color} fillPct={fillPct} secondaryPct={secondaryPct} shareOfTotal={shareOfTotal} />
      {showActive ? <ActiveCell pct={activePct} /> : <span />}
      {stats.map((s, i) => (
        <StatCell key={i} stat={s} />
      ))}
    </div>
  )
}

function FilteredDeathsTable({
  events,
  perspective,
  filters,
  allies,
}: {
  events: Parameters<typeof computeDeathRows>[0]
  perspective: Parameters<typeof computeDeathRows>[1]
  filters: Parameters<typeof computeDeathRows>[2]
  allies: Record<string, PlayerSnapshot>
}) {
  const playerSpecs = useStore(s => s.playerSpecs)

  const rows = useMemo(
    () => computeDeathRows(events, perspective, filters, allies),
    [events, perspective, filters, allies]
  )

  // Elapsed reference: for the first death, firstEventTime is unknown to the
  // engine, so compute it here from the earliest known event instead.
  const firstEventT = events.length > 0 ? events[0].t : rows[0]?.t ?? 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <DeathsColumnHeader />
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <EmptyState text="No deaths recorded" />
        ) : (
          rows.map((row, i) => (
            <FullDeathRow
              key={`${row.victimName}-${row.t}-${i}`}
              row={row}
              rank={i + 1}
              specId={resolveSpecId(playerSpecs, row.victimName, row.victimSpecId)}
              killerSpecId={allies[row.killerName] ? resolveSpecId(playerSpecs, row.killerName, allies[row.killerName]?.specId) : undefined}
              elapsedSec={(row.t - firstEventT) / 1000}
            />
          ))
        )}
      </div>
    </div>
  )
}

function DeathsColumnHeader() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: DEATHS_GRID_COLUMNS,
        alignItems: 'center',
        gap: 12,
        padding: '6px 14px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <HeaderCell align="center">#</HeaderCell>
      <HeaderCell align="right">Time</HeaderCell>
      <HeaderCell>Victim</HeaderCell>
      <HeaderCell>Killing Blow</HeaderCell>
      <HeaderCell>Source</HeaderCell>
      <HeaderCell align="right">Overkill</HeaderCell>
    </div>
  )
}

const FullDeathRow = memo(FullDeathRowImpl)

function FullDeathRowImpl({
  row,
  rank,
  specId,
  killerSpecId,
  elapsedSec,
}: {
  row: DeathRow
  rank: number
  specId: number | undefined
  killerSpecId: number | undefined
  elapsedSec: number
}) {
  const color = getClassColor(specId)
  const specIcon = specIconUrl(specId)
  const killerIsPlayer = killerSpecId !== undefined
  const killerColor = killerIsPlayer ? getClassColor(killerSpecId) : 'var(--text-secondary)'
  const killerIcon = killerIsPlayer ? specIconUrl(killerSpecId) : null

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: DEATHS_GRID_COLUMNS,
        alignItems: 'center',
        gap: 12,
        minHeight: 36,
        padding: '0 14px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <RankCell rank={rank} />
      <span style={{
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--status-wipe)',
        textAlign: 'right',
      }}>
        {formatElapsed(elapsedSec)}
      </span>
      <PlayerNameCell name={row.victimName} color={color} specIcon={specIcon} />
      <span className="truncate" style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 0 }}>
        {row.ability || '—'}
      </span>
      {killerIsPlayer ? (
        <PlayerNameCell name={row.killerName} color={killerColor} specIcon={killerIcon} />
      ) : (
        <span className="truncate" style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 0 }}>
          {row.killerName || '—'}
        </span>
      )}
      <span style={{
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
        textAlign: 'right',
        color: row.overkill && row.overkill > 0 ? 'var(--status-wipe)' : 'var(--text-muted)',
      }}>
        {row.overkill && row.overkill > 0 ? row.overkill.toLocaleString() : '—'}
      </span>
    </div>
  )
}

// ——— Shared cells ———

function HeaderCell({
  children,
  align = 'left',
}: {
  children?: React.ReactNode
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 500,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--text-muted)',
      textAlign: align,
    }}>
      {children}
    </span>
  )
}

function RankCell({ rank }: { rank: number }) {
  return (
    <span style={{
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      color: 'var(--text-muted)',
      textAlign: 'center',
    }}>
      {rank}
    </span>
  )
}

function PlayerNameCell({
  name,
  color,
  specIcon,
}: {
  name: string
  color: string
  specIcon: string | null
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {specIcon && (
        <img
          src={specIcon}
          alt=""
          width={18}
          height={18}
          style={{
            border: '1px solid rgba(0, 0, 0, 0.7)',
            borderRadius: 2,
            flexShrink: 0,
          }}
          onError={e => { e.currentTarget.style.display = 'none' }}
        />
      )}
      <span className="truncate" style={{ fontSize: 13, fontWeight: 500, color, minWidth: 0 }}>
        {shortName(name)}
      </span>
    </div>
  )
}

function BarCell({
  color,
  fillPct,
  secondaryPct,
  shareOfTotal,
}: {
  color: string
  fillPct: number
  // Secondary segment stacked after the primary fill with a lighter opacity.
  // Healing-raw uses it for overheal; damageTaken-incoming uses it for
  // mitigated. 0 for lenses/metrics without a stacked dimension.
  secondaryPct: number
  shareOfTotal: number
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <div style={{
        flex: 1,
        height: 14,
        background: 'var(--bg-hover)',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
      }}>
        <div style={{
          width: `${fillPct}%`,
          height: '100%',
          background: color,
          opacity: 0.85,
        }} />
        {secondaryPct > 0 && (
          <div style={{
            width: `${secondaryPct}%`,
            height: '100%',
            background: color,
            opacity: 0.25,
          }} />
        )}
      </div>
      <span style={{
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)',
        minWidth: 40,
        flexShrink: 0,
        textAlign: 'right',
      }}>
        {shareOfTotal.toFixed(1)}%
      </span>
    </div>
  )
}

function ActiveCell({ pct }: { pct: number | null }) {
  return (
    <span style={{
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
      textAlign: 'right',
      color: 'var(--text-secondary)',
    }}>
      {pct === null ? '—' : `${Math.round(pct)}%`}
    </span>
  )
}

function StatCell({ stat }: { stat: NumericStat }) {
  return (
    <span style={{
      fontSize: stat.bold ? 13 : 12,
      fontFamily: 'var(--font-mono)',
      fontWeight: stat.bold ? 600 : 400,
      color: stat.bold ? 'var(--text-primary)' : 'var(--text-secondary)',
      textAlign: 'right',
    }}>
      {formatStat(stat)}
      {stat.suffix && (
        <span style={{ marginLeft: 4, color: 'var(--text-muted)' }}>
          {stat.suffix}
        </span>
      )}
    </span>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-8" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
      {text}
    </div>
  )
}

function formatElapsed(sec: number): string {
  const safe = Math.max(0, sec)
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Placeholder for the Full view while an aggregate snapshot is being fetched.
// Mirrors the grid layout so the swap feels stable.
function FullLoadingSkeleton() {
  return (
    <div
      className="animate-pulse-dot"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '6px 14px' }}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: playerGridColumns(2),
        gap: 12,
        padding: '6px 0',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div /><div /><div /><div /><div /><div />
      </div>
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: playerGridColumns(2),
            gap: 12,
            alignItems: 'center',
            minHeight: 36,
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <span />
          <div style={{ height: 12, width: '70%', background: 'var(--bg-hover)', borderRadius: 2 }} />
          <div style={{ height: 10, width: `${85 - i * 6}%`, background: 'var(--bg-hover)', borderRadius: 2 }} />
          <span />
          <div style={{ height: 10, width: '60%', background: 'var(--bg-hover)', borderRadius: 2, justifySelf: 'end' }} />
          <div style={{ height: 10, width: '60%', background: 'var(--bg-hover)', borderRadius: 2, justifySelf: 'end' }} />
          <div style={{ height: 10, width: '50%', background: 'var(--bg-hover)', borderRadius: 2, justifySelf: 'end' }} />
        </div>
      ))}
    </div>
  )
}

// ─── Auras (Buffs / Debuffs) ──────────────────────────────────────────────
// Per-aura rows. Buffs are grouped by Personal / Raid / External
// classification; Debuffs render flat (no section taxonomy). The Section
// column is reserved in the grid for both so tab-switching doesn't cause the
// header to reflow.
// Grid: rank | icon+name (flex) | section badge | timeline bar | uptime% | count.
const AURAS_GRID_COLUMNS = '32px minmax(240px, 1.2fr) 80px minmax(160px, 2fr) 80px 80px'

const SECTION_LABELS: Record<BuffSection, string> = {
  personal: 'Personal',
  raid: 'Raid',
  external: 'External',
}

// Per-row accent when no section applies (debuffs). Picked to sit apart from
// the buff section palette so a row-level glance distinguishes them.
const DEBUFF_BAR_COLOR = '#a855f7'

function FilteredAurasTable({
  kind,
  auras,
  classification,
  filters,
  startTime,
  endTime,
  durationSec,
  allies,
  perspective,
}: {
  kind: AuraKind
  auras: AuraWindowWire[]
  classification: Record<string, BuffSection>
  filters: FilterState
  startTime: number
  endTime: number | null
  durationSec: number
  allies: Record<string, PlayerSnapshot>
  perspective: Perspective
}) {
  const selectedAura = useStore(s => s.selectedAura)
  const setSelectedAura = useStore(s => s.setSelectedAura)
  const isBuff = kind === 'BUFF'
  // Collapse state is per-section and local to the table instance. Reset on
  // remount (i.e. new scope / perspective / kind swap) is fine — exploring a
  // fresh pull is a fresh read. A Set means an absent key = expanded, which
  // keeps the default "everything visible" behavior without seeding on mount.
  const [collapsed, setCollapsed] = useState<Set<BuffSection>>(() => new Set())
  const toggleSection = useCallback((key: BuffSection) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])
  // For in-progress scopes (endTime === null) we can't reach this path in
  // practice — Full mode is gated on completed snapshots — but defend anyway
  // by deriving tEnd from durationSec.
  const tEnd = endTime ?? (startTime + durationSec * 1000)

  const rows = useMemo(
    () => computeAuraRows(auras, classification, filters, startTime, tEnd, allies, perspective, kind),
    [auras, classification, filters, startTime, tEnd, allies, perspective, kind],
  )

  // Group into section runs for buffs (already sorted by section → uptime%).
  // Debuffs get a single synthetic group so the same renderer walks them.
  const grouped = useMemo(() => {
    if (!isBuff) return [{ key: null as BuffSection | null, rows }]
    const out: { key: BuffSection | null; rows: AuraRow[] }[] = []
    let cur: { key: BuffSection | null; rows: AuraRow[] } | null = null
    for (const r of rows) {
      const section = r.section ?? 'external'
      if (!cur || cur.key !== section) {
        cur = { key: section, rows: [] }
        out.push(cur)
      }
      cur.rows.push(r)
    }
    return out
  }, [rows, isBuff])

  const kindLabel = isBuff ? 'buff' : 'debuff'

  // Empty-state fork — three distinct "rows is empty" states:
  //   1. auras.length === 0          → snapshot had no aura activity
  //                                    (pre-aura legacy or truly quiet pull).
  //   2. rows empty + filter active  → the user's chips narrowed everything
  //                                    away; show the filter-guidance state.
  //   3. rows empty + no filter      → scope intersection yielded nothing
  //                                    (e.g. zero-width TimeWindow) or no
  //                                    auras of the active kind exist.
  if (auras.length === 0) {
    return <EmptyState text={`No ${kindLabel} data in this scope`} />
  }
  if (rows.length === 0) {
    const anyFilter = !!(filters.Source || filters.Target || filters.Ability || filters.TimeWindow)
    if (anyFilter && !hasMatchingAuraData(auras, filters, startTime, tEnd, allies, perspective, kind)) {
      return <FilterEmptyState />
    }
    return <EmptyState text={`No ${kindLabel} data in this scope`} />
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <AurasColumnHeader kind={kind} />
      <div className="flex-1 overflow-y-auto">
        {grouped.map(group => {
          // Debuffs: no section headers, flat list.
          if (group.key === null) {
            return (
              <div key="flat">
                {group.rows.map((row, i) => (
                  <FullAuraRow
                    key={row.spellId}
                    row={row}
                    rank={i + 1}
                    t0Ms={startTime}
                    tEndMs={tEnd}
                    isSelected={selectedAura === row.spellId}
                    onClick={() => setSelectedAura(selectedAura === row.spellId ? null : row.spellId)}
                  />
                ))}
              </div>
            )
          }
          const isCollapsed = collapsed.has(group.key)
          return (
            <div key={group.key}>
              <AuraSectionHeader
                label={SECTION_LABELS[group.key]}
                count={group.rows.length}
                collapsed={isCollapsed}
                onToggle={() => toggleSection(group.key!)}
              />
              {!isCollapsed && group.rows.map((row, i) => (
                <FullAuraRow
                  key={row.spellId}
                  row={row}
                  rank={i + 1}
                  t0Ms={startTime}
                  tEndMs={tEnd}
                  isSelected={selectedAura === row.spellId}
                  onClick={() => setSelectedAura(selectedAura === row.spellId ? null : row.spellId)}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AurasColumnHeader({ kind }: { kind: AuraKind }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: AURAS_GRID_COLUMNS,
        alignItems: 'center',
        gap: 12,
        padding: '6px 14px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <HeaderCell align="center">#</HeaderCell>
      <HeaderCell>{kind === 'BUFF' ? 'Buff' : 'Debuff'}</HeaderCell>
      <HeaderCell align="right">{kind === 'BUFF' ? 'Section' : ''}</HeaderCell>
      <HeaderCell>Uptime</HeaderCell>
      <HeaderCell align="right">Uptime %</HeaderCell>
      <HeaderCell align="right">Count</HeaderCell>
    </div>
  )
}

function AuraSectionHeader({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <div
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
      style={{
        padding: '6px 14px',
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--text-muted)',
        background: 'var(--bg-root)',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        userSelect: 'none',
        transition: 'color 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
    >
      {/* Monospace chevron keeps horizontal alignment stable when the rotation
          swaps between ▸ and ▾ (different advance widths on some fonts). */}
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        width: 10,
        display: 'inline-block',
        textAlign: 'center',
      }}>
        {collapsed ? '▸' : '▾'}
      </span>
      {label}
      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
        ({count})
      </span>
    </div>
  )
}

const FullAuraRow = memo(FullAuraRowImpl)

function FullAuraRowImpl({
  row,
  rank,
  t0Ms,
  tEndMs,
  isSelected,
  onClick,
}: {
  row: AuraRow
  rank: number
  t0Ms: number
  tEndMs: number
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: AURAS_GRID_COLUMNS,
        alignItems: 'center',
        gap: 12,
        minHeight: 32,
        padding: '0 14px',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        background: isSelected ? 'var(--bg-active)' : 'transparent',
        transition: 'background 0.1s',
      }}
      onMouseEnter={!isSelected ? e => { e.currentTarget.style.background = 'var(--bg-hover)' } : undefined}
      onMouseLeave={!isSelected ? e => { e.currentTarget.style.background = 'transparent' } : undefined}
    >
      <RankCell rank={rank} />
      <AuraNameCell spellId={row.spellId} spellName={row.spellName} />
      <SectionBadge section={row.section} />
      <AuraTimelineBar windows={row.windows} t0Ms={t0Ms} tEndMs={tEndMs} section={row.section} />
      <span style={{
        fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600,
        color: 'var(--text-primary)', textAlign: 'right',
      }}>
        {row.uptimePct.toFixed(2)}%
      </span>
      <span style={{
        fontSize: 12, fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)', textAlign: 'right',
      }}>
        {row.count}
      </span>
    </div>
  )
}

// Per-row canvas strip showing union-of-windows for a single aura. Union
// (not per-window-stacked) because the uptime metric shows "was anyone
// affected" — matching what the % reads. Resize-aware via ResizeObserver so
// the strip adapts to grid column changes.
const TIMELINE_BAR_HEIGHT = 8
const SECTION_BAR_COLORS: Record<BuffSection, string> = {
  personal: '#64748b',   // muted slate — low signal weight
  raid:     '#22c55e',   // green, matches the section badge
  external: '#f59e0b',   // amber, matches the section badge
}

function AuraTimelineBar({
  windows,
  t0Ms,
  tEndMs,
  section,
}: {
  windows: AuraWindowWire[]
  t0Ms: number
  tEndMs: number
  // Buffs always carry a section; debuffs don't and fall back to the shared
  // debuff accent so the strip still reads coherently against adjacent rows.
  section: BuffSection | undefined
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const color = section ? SECTION_BAR_COLORS[section] : DEBUFF_BAR_COLOR

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const container = containerRef.current
    if (!container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const cssW = container.clientWidth
    const cssH = TIMELINE_BAR_HEIGHT
    if (cssW <= 0) return
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const scopeMs = tEndMs - t0Ms
    if (scopeMs <= 0 || windows.length === 0) {
      drawTimelineTrack(ctx, cssW, cssH)
      return
    }

    drawTimelineTrack(ctx, cssW, cssH)

    // Union-in-one-sweep: sort by start, merge overlaps, fill each merged run.
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
      const w = Math.max(1, x1 - x0)   // ensure a sub-pixel window still draws
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
    <div
      ref={containerRef}
      style={{
        height: TIMELINE_BAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  )
}

function drawTimelineTrack(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  ctx.fillRect(0, 0, w, h)
}

function AuraNameCell({ spellId, spellName }: { spellId: string; spellName: string }) {
  const iconName = useStore(s => s.spellIcons[spellId])
  const url = spellIconUrl(iconName)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <div style={{
        width: 18, height: 18, flexShrink: 0,
        border: '1px solid rgba(0, 0, 0, 0.7)',
        borderRadius: 2,
        background: 'rgba(255, 255, 255, 0.04)',
        overflow: 'hidden',
      }}>
        {url && (
          <img
            src={url}
            alt=""
            width={18}
            height={18}
            style={{ display: 'block' }}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        )}
      </div>
      <span className="truncate" style={{ fontSize: 13, color: 'var(--text-primary)', minWidth: 0 }}>
        {spellName}
      </span>
    </div>
  )
}

function SectionBadge({ section }: { section: BuffSection | undefined }) {
  // Debuffs render no badge — the grid cell stays reserved so rows align.
  if (!section) return <span />
  const color =
    section === 'raid'     ? 'var(--status-success, #22c55e)'
    : section === 'external' ? 'var(--data-group-avg, #f59e0b)'
    : 'var(--text-muted)'
  return (
    <span style={{
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color,
      textAlign: 'right',
      fontFamily: 'var(--font-mono)',
    }}>
      {SECTION_LABELS[section]}
    </span>
  )
}

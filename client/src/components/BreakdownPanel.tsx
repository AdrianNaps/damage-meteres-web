import { useEffect, useState } from 'react'
import { useStore, selectCurrentView, resolveSpecId } from '../store'
import { getClassColor } from './PlayerRow'
import {
  DamageSpellTable,
  HealSpellTable,
  InterruptSpellTable,
  FullDamageSpellTable,
  FullHealSpellTable,
} from './SpellTable'
import { TargetTable, type TargetRowStyle } from './TargetTable'
import { TargetScopedSpellTable, FullTargetScopedSpellTable } from './SpellTable'
import { specIconUrl } from '../utils/icons'
import { formatNum, shortName } from '../utils/format'
import type { ClientEvent } from '../types'

const METRIC_LABELS: Record<string, string> = {
  damage: 'Damage',
  healing: 'Healing',
  deaths: 'Deaths',
  interrupts: 'Interrupts',
}

export function BreakdownPanel() {
  const selectedPlayer = useStore(s => s.selectedPlayer)
  const currentView = useStore(selectCurrentView)
  const metric = useStore(s => s.drillMetric ?? s.metric)
  const mode = useStore(s => s.mode)
  const setSelectedPlayer = useStore(s => s.setSelectedPlayer)
  const [viewMode, setViewMode] = useState<'spells' | 'targets'>('spells')
  const [drillTarget, setDrillTarget] = useState<string | null>(null)
  const playerSpecs = useStore(s => s.playerSpecs)

  // Reset drill state when the player OR the metric changes — switching
  // damage→healing on the same player would otherwise leave a stale damage-
  // world target visible under a "Healing" heading.
  useEffect(() => {
    setDrillTarget(null)
  }, [selectedPlayer, metric])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drillTarget) {
          setDrillTarget(null)
        } else {
          setSelectedPlayer(null)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drillTarget, setSelectedPlayer])

  if (!selectedPlayer || !currentView) return null

  const player = currentView.players[selectedPlayer]
  if (!player) return null

  const color = getClassColor(resolveSpecId(playerSpecs, selectedPlayer, player.specId))
  const value =
    metric === 'damage' ? player.dps
    : metric === 'healing' ? player.hps
    : player.interrupts.total
  const total =
    metric === 'damage' ? player.damage.total
    : metric === 'healing' ? player.healing.total
    : player.interrupts.total
  // Duration shape varies by view: segments carry `duration`, while key-run
  // and boss-section aggregates carry `activeDurationSec`. Per-spell DPS/HPS
  // cells come out as 0 on aggregate views if we don't handle both.
  const duration =
    'duration' in currentView ? currentView.duration
    : 'activeDurationSec' in currentView ? currentView.activeDurationSec
    : 0

  function handleModeChange(mode: 'spells' | 'targets') {
    setViewMode(mode)
    if (mode !== 'targets') {
      setDrillTarget(null)
    }
  }

  function renderContent() {
    if (!currentView) return null
    if (metric === 'interrupts') {
      return (
        <>
          <InterruptSpellTable spells={player.interrupts.byKicker} heading="Interrupt Ability" classColor={color} />
          <InterruptSpellTable spells={player.interrupts.byKicked} heading="Spell Interrupted" classColor={color} />
        </>
      )
    }
    const isHealing = metric === 'healing'
    // Player-aware row decorator: resolves healing sources/targets to their own
    // class color, spec icon, and short name. Reused by the targets list and
    // the drill-down heading so the whole healing flow reads consistently.
    const playerRowStyle = (name: string): TargetRowStyle | null => {
      const specId = resolveSpecId(playerSpecs, name)
      if (specId === undefined) return null
      return { displayName: shortName(name), color: getClassColor(specId), specId }
    }

    if (drillTarget) {
      const events: ClientEvent[] = currentView.events ?? []
      const kind = isHealing ? 'heal' : 'damage'
      const headingStyle = isHealing ? playerRowStyle(drillTarget) : null
      return (
        <TargetScopedView
          targetName={drillTarget}
          headingStyle={headingStyle}
          onBack={() => setDrillTarget(null)}
        >
          {mode === 'full' ? (
            <FullTargetScopedSpellTable
              events={events}
              playerName={player.name}
              targetName={drillTarget}
              kind={kind}
              classColor={color}
              duration={duration}
            />
          ) : (
            <TargetScopedSpellTable
              events={events}
              playerName={player.name}
              targetName={drillTarget}
              kind={kind}
              classColor={color}
            />
          )}
        </TargetScopedView>
      )
    }
    if (viewMode === 'targets') {
      const resolveRow = isHealing ? playerRowStyle : undefined
      return (
        <TargetTable
          targets={isHealing ? player.healing.targets : player.damage.targets}
          totalAmount={isHealing ? player.healing.total : player.damage.total}
          duration={duration}
          rateLabel={isHealing ? 'HPS' : 'DPS'}
          classColor={color}
          resolveRow={resolveRow}
          onSelect={(name) => setDrillTarget(name)}
        />
      )
    }
    if (mode === 'full') {
      return isHealing
        ? <FullHealSpellTable spells={player.healing.spells} classColor={color} duration={duration} playerTotal={player.healing.total} />
        : <FullDamageSpellTable spells={player.damage.spells} classColor={color} duration={duration} playerTotal={player.damage.total} />
    }
    return isHealing
      ? <HealSpellTable spells={player.healing.spells} classColor={color} />
      : <DamageSpellTable spells={player.damage.spells} classColor={color} />
  }

  return (
    <>
      {/* Header with class color accent */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{
          borderBottom: '1px solid var(--border-default)',
          borderLeft: `4px solid ${color}`,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 15, color }}>{shortName(player.name)}</span>
            <span style={{
              fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
              padding: '1px 6px', borderRadius: 2,
              background: 'var(--bg-active)', color: 'var(--header-accent)',
            }}>
              {METRIC_LABELS[metric]}
            </span>
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginTop: 2 }}>
            {metric === 'interrupts'
              ? `${total} interrupts`
              : `${formatNum(total)} total \u00b7 ${formatNum(value)} ${metric === 'damage' ? 'DPS' : 'HPS'}`}
          </div>
        </div>
        <button
          onClick={() => setSelectedPlayer(null)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 20,
            lineHeight: 1,
            padding: '4px 8px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          &times;
        </button>
      </div>

      {/* View mode toggle */}
      {(metric === 'damage' || metric === 'healing') && (
        <div className="px-4 pt-2.5">
          <SegmentedControl
            options={[
              { key: 'spells', label: 'Spells' },
              { key: 'targets', label: 'Targets' },
            ]}
            active={viewMode}
            onChange={handleModeChange}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {renderContent()}
      </div>
    </>
  )
}

function SegmentedControl<T extends string>({
  options,
  active,
  onChange,
}: {
  options: { key: T; label: string }[]
  active: T
  onChange: (key: T) => void
}) {
  return (
    <div
      className="inline-flex"
      style={{ border: '1px solid var(--border-default)' }}
    >
      {options.map(opt => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          style={{
            padding: '3px 12px',
            fontSize: 11,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            cursor: 'pointer',
            border: 'none',
            borderRight: '1px solid var(--border-default)',
            background: active === opt.key ? 'var(--bg-active)' : 'transparent',
            color: active === opt.key ? 'var(--text-primary)' : 'var(--text-secondary)',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => {
            if (active !== opt.key) {
              e.currentTarget.style.background = 'var(--bg-hover)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }
          }}
          onMouseLeave={e => {
            if (active !== opt.key) {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// Target-drill wrapper: back button + heading, shared across Summary and Full.
// Body (the scoped ability list) is passed in as children so the frame stays
// identical while the layout varies per mode.
function TargetScopedView({
  targetName,
  headingStyle,
  onBack,
  children,
}: {
  targetName: string
  headingStyle: TargetRowStyle | null
  onBack: () => void
  children: React.ReactNode
}) {
  const headingName = headingStyle?.displayName ?? targetName
  const headingColor = headingStyle?.color ?? 'var(--text-primary)'
  const headingIcon = specIconUrl(headingStyle?.specId)
  return (
    <div>
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--text-secondary)',
          padding: '0 16px',
          marginBottom: 12,
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
      >
        &larr; Targets
      </button>
      <div style={{ marginBottom: 8, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {headingIcon && (
          <img
            src={headingIcon}
            alt=""
            width={20}
            height={20}
            style={{ flexShrink: 0, border: '1px solid rgba(0, 0, 0, 0.7)', borderRadius: 2 }}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <span style={{ fontSize: 14, fontWeight: 600, color: headingColor }}>
          {headingName}
        </span>
      </div>
      {children}
    </div>
  )
}

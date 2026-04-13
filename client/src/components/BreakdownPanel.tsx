import { useEffect, useState } from 'react'
import { useStore, selectCurrentView, resolveSpecId } from '../store'
import { getClassColor } from './PlayerRow'
import { DamageSpellTable, HealSpellTable, InterruptSpellTable } from './SpellTable'
import { TargetTable } from './TargetTable'
import { TargetDrillDown } from './TargetDrillDown'
import { requestTargetDetail } from '../ws'
import { formatNum, shortName } from '../utils/format'

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
  const setSelectedPlayer = useStore(s => s.setSelectedPlayer)
  const [viewMode, setViewMode] = useState<'spells' | 'targets'>('spells')
  const [drillTarget, setDrillTarget] = useState<string | null>(null)
  const targetDetail = useStore(s => s.targetDetail)
  const setTargetDetail = useStore(s => s.setTargetDetail)
  const playerSpecs = useStore(s => s.playerSpecs)

  const isAggregate = currentView?.type === 'key_run' || currentView?.type === 'boss_section'
  const canDrillTargets = !isAggregate

  useEffect(() => {
    setDrillTarget(null)
    setTargetDetail(null)
  }, [selectedPlayer, setTargetDetail])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drillTarget) {
          setDrillTarget(null)
          setTargetDetail(null)
        } else {
          setSelectedPlayer(null)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drillTarget, setSelectedPlayer, setTargetDetail])

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
  const duration = (currentView as { duration?: number }).duration ?? 0

  function handleModeChange(mode: 'spells' | 'targets') {
    setViewMode(mode)
    if (mode !== 'targets') {
      setDrillTarget(null)
      setTargetDetail(null)
    }
  }

  function renderContent() {
    if (!currentView) return null
    if (metric === 'healing') {
      return <HealSpellTable spells={player.healing.spells} classColor={color} />
    }
    if (metric === 'interrupts') {
      return (
        <>
          <InterruptSpellTable spells={player.interrupts.byKicker} heading="Interrupt Ability" classColor={color} />
          <InterruptSpellTable spells={player.interrupts.byKicked} heading="Spell Interrupted" classColor={color} />
        </>
      )
    }
    if (canDrillTargets && drillTarget && targetDetail?.targetName === drillTarget) {
      return (
        <TargetDrillDown
          detail={targetDetail}
          onBack={() => { setDrillTarget(null); setTargetDetail(null) }}
        />
      )
    }
    if (canDrillTargets && viewMode === 'targets') {
      const segmentId = (currentView as { id: string }).id
      return (
        <TargetTable
          targets={player.damage.targets}
          totalDamage={player.damage.total}
          duration={duration}
          onSelect={(name) => {
            setDrillTarget(name)
            requestTargetDetail(segmentId, name)
          }}
        />
      )
    }
    return <DamageSpellTable spells={player.damage.spells} classColor={color} />
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
      {metric === 'damage' && canDrillTargets && (
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

import { useEffect, useState } from 'react'
import { useStore, selectCurrentView, resolveSpecId } from '../store'
import { getClassColor } from './PlayerRow'
import { DamageSpellTable, HealSpellTable } from './SpellTable'
import { TargetTable } from './TargetTable'
import { TargetDrillDown } from './TargetDrillDown'
import { requestTargetDetail } from '../ws'
import { formatNum, shortName } from '../utils/format'

export function BreakdownPanel() {
  const selectedPlayer = useStore(s => s.selectedPlayer)
  const currentView = useStore(selectCurrentView)
  const metric = useStore(s => s.metric)
  const setSelectedPlayer = useStore(s => s.setSelectedPlayer)
  const [viewMode, setViewMode] = useState<'spells' | 'targets'>('spells')
  const [drillTarget, setDrillTarget] = useState<string | null>(null)
  const targetDetail = useStore(s => s.targetDetail)
  const setTargetDetail = useStore(s => s.setTargetDetail)
  const playerSpecs = useStore(s => s.playerSpecs)

  const isKeyRun = currentView?.type === 'key_run'
  const canDrillTargets = !isKeyRun

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
  const value = metric === 'damage' ? player.dps : player.hps
  const total = metric === 'damage' ? player.damage.total : player.healing.total
  const duration = isKeyRun ? currentView.activeDurationSec : currentView.duration

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
      return <HealSpellTable spells={player.healing.spells} />
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
    return <DamageSpellTable spells={player.damage.spells} />
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0, 0, 0, 0.6)' }}
        onClick={() => setSelectedPlayer(null)}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 h-full w-full max-w-lg z-50 flex flex-col"
        style={{
          background: 'var(--bg-elevated)',
          borderLeft: '1px solid var(--border-default)',
          boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.4)',
        }}
      >
        {/* Header with class color accent */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{
            borderBottom: '1px solid var(--border-default)',
            borderLeft: `4px solid ${color}`,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color }}>{shortName(player.name)}</div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginTop: 2 }}>
              {formatNum(total)} total &middot; {formatNum(value)} {metric === 'damage' ? 'DPS' : 'HPS'}
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

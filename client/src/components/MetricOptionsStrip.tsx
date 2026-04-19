import { useStore } from '../store'

// Reserved slot between the graph and the table in Full mode. Rendered for
// every metric (even when empty) so the table doesn't shift vertically when
// the user switches categories. Left side previews where a future Table /
// Timeline view switcher will live; right side hosts metric-specific options.
export function MetricOptionsStrip() {
  const metric = useStore(s => s.metric)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '4px 16px',
      minHeight: 30,
      borderBottom: '1px solid var(--border-subtle)',
      flexShrink: 0,
      background: 'var(--bg-root)',
    }}>
      <div />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {metric === 'healing' && <HealingOptions />}
        {metric === 'damageTaken' && <DamageTakenOptions />}
        {metric === 'interrupts' && <InterruptsOptions />}
      </div>
    </div>
  )
}

function HealingOptions() {
  const lens = useStore(s => s.healingLens)
  const setLens = useStore(s => s.setHealingLens)
  return (
    <div style={{
      display: 'inline-flex',
      border: '1px solid var(--border-default)',
      borderRadius: 3,
      overflow: 'hidden',
    }}>
      <LensSegment label="Effective"        active={lens === 'effective'} onClick={() => setLens('effective')} isFirst />
      <LensSegment label="Include overheal" active={lens === 'raw'}       onClick={() => setLens('raw')} />
    </div>
  )
}

function InterruptsOptions() {
  const lens = useStore(s => s.interruptsLens)
  const setLens = useStore(s => s.setInterruptsLens)
  return (
    <div style={{
      display: 'inline-flex',
      border: '1px solid var(--border-default)',
      borderRadius: 3,
      overflow: 'hidden',
    }}>
      <LensSegment label="Lands"             active={lens === 'lands'}    onClick={() => setLens('lands')} isFirst />
      <LensSegment label="Include attempts"  active={lens === 'attempts'} onClick={() => setLens('attempts')} />
    </div>
  )
}

function DamageTakenOptions() {
  const lens = useStore(s => s.damageTakenLens)
  const setLens = useStore(s => s.setDamageTakenLens)
  return (
    <div style={{
      display: 'inline-flex',
      border: '1px solid var(--border-default)',
      borderRadius: 3,
      overflow: 'hidden',
    }}>
      <LensSegment label="Incoming"  active={lens === 'incoming'}  onClick={() => setLens('incoming')} isFirst />
      <LensSegment label="Effective" active={lens === 'effective'} onClick={() => setLens('effective')} />
      <LensSegment label="Mitigated" active={lens === 'mitigated'} onClick={() => setLens('mitigated')} />
    </div>
  )
}

function LensSegment({
  label,
  active,
  onClick,
  isFirst,
}: {
  label: string
  active: boolean
  onClick: () => void
  isFirst?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '2px 10px',
        height: 22,
        fontSize: 11,
        fontWeight: 500,
        fontFamily: 'var(--font-sans)',
        background: active ? 'var(--bg-active)' : 'transparent',
        border: 'none',
        borderLeft: isFirst ? 'none' : '1px solid var(--border-default)',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = 'var(--bg-hover)'
          e.currentTarget.style.color = 'var(--text-primary)'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }
      }}
    >
      {label}
    </button>
  )
}

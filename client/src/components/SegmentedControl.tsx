// Inline tab-style toggle used across drill surfaces (Spells/Targets on the
// damage drill, Recipients/Casters on the buffs drill). Generic on T so each
// caller keeps its own keyed view-mode type without stringly casts.
export function SegmentedControl<T extends string>({
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

import { useStore, selectCurrentView } from '../store'
import { mostRestrictiveFilter } from '../utils/filters'

// Shown in place of the main row list when the current filter combination
// produces no data. Uses the filter engine's most-restrictive heuristic to
// hint which filter to relax first.
export function FilterEmptyState() {
  const perspective = useStore(s => s.perspective)
  const filters = useStore(s => s.filters)
  const metric = useStore(s => s.metric)
  const clearAllFilters = useStore(s => s.clearAllFilters)
  const currentView = useStore(selectCurrentView)

  const events = currentView?.events ?? []
  const allies = currentView?.players ?? {}

  const hint = mostRestrictiveFilter(events, perspective, filters, metric, allies)

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      padding: 40,
      color: 'var(--text-secondary)',
    }}>
      <div style={{ fontSize: 13 }}>
        No data matches the current filters.
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {hint
          ? <>Try removing <span style={{ color: 'var(--text-secondary)' }}>{hint.label}</span>.</>
          : <>Try relaxing one or more filters to see data.</>
        }
      </div>
      <button
        onClick={clearAllFilters}
        style={{
          marginTop: 8,
          padding: '6px 14px',
          fontSize: 12,
          fontFamily: 'var(--font-sans)',
          background: 'var(--bg-active)',
          border: '1px solid var(--border-default)',
          borderRadius: 3,
          color: 'var(--text-primary)',
          cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--bg-hover)'
          e.currentTarget.style.borderColor = 'var(--text-secondary)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'var(--bg-active)'
          e.currentTarget.style.borderColor = 'var(--border-default)'
        }}
      >
        Clear filters
      </button>
    </div>
  )
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

export interface PickerOption {
  name: string
  group?: string        // optional group label; options with the same group render together
  subtitle?: string     // secondary line (e.g. spec name, or "by X sources · 42.5%")
  pct?: number          // ability-only: share-of-impact bar value, 0–100
  color?: string        // optional accent (e.g. class color for name)
}

interface Props {
  anchorRef: RefObject<HTMLElement | null>
  options: PickerOption[]
  selected: string[]
  onToggle: (name: string) => void
  onClose: () => void
  placeholder?: string
}

// Shared popover for Source / Target / Ability pickers. Renders a search input,
// grouped checkable list, and keyboard nav (↑↓ to move highlight, space/↵ to
// toggle, Esc to close). Positioned relative to the anchor element; caller owns
// the open/close lifecycle and provides a pre-filtered options list.
export function FilterPicker({ anchorRef, options, selected, onToggle, onClose, placeholder }: Props) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Compute anchor position after mount (layout effect so it's done before
  // paint). Recomputes on window resize so the popover stays glued to the
  // picker button even if the viewport shifts underneath it.
  useLayoutEffect(() => {
    function update() {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (rect) setPos({ top: rect.bottom + 6, left: rect.left })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [anchorRef])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o =>
      o.name.toLowerCase().includes(q) ||
      o.group?.toLowerCase().includes(q) ||
      o.subtitle?.toLowerCase().includes(q)
    )
  }, [options, query])

  // Reset cursor when filter shrinks below it so arrow keys stay in-bounds.
  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1))
  }, [filtered, cursor])

  // Outside-click dismisses the popover. Capture phase so we beat the picker
  // button's own onClick (otherwise click-outside fires before the button's
  // toggle and the popover flickers back open).
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!rootRef.current) return
      if (rootRef.current.contains(e.target as Node)) return
      // Picker button lives outside the popover and handles its own toggle.
      if ((e.target as HTMLElement).closest?.('[data-picker-button]')) return
      onClose()
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onClose])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(filtered.length - 1, c + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(0, c - 1))
      return
    }
    // Space must still be typable in the search input — only treat it as
    // toggle when focus isn't in the input. Enter works from either.
    const spaceInInput = e.key === ' ' && e.target === inputRef.current
    if ((e.key === 'Enter' || e.key === ' ') && !spaceInInput) {
      if (filtered[cursor]) {
        e.preventDefault()
        onToggle(filtered[cursor].name)
      }
    }
  }

  const top = pos?.top ?? 120
  const left = pos?.left ?? 120

  // Group rendering: walk filtered options in order; emit a group header
  // whenever the group label changes. Options with no group render flat.
  const groups: { label: string | null; items: PickerOption[] }[] = []
  let currentLabel: string | null | undefined
  for (const opt of filtered) {
    const label = opt.group ?? null
    if (label !== currentLabel) {
      groups.push({ label, items: [opt] })
      currentLabel = label
    } else {
      groups[groups.length - 1].items.push(opt)
    }
  }

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 1000,
        minWidth: 240,
        maxWidth: 320,
        maxHeight: 380,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 4,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 8, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder ?? 'Search…'}
          style={{
            width: '100%',
            fontSize: 12,
            padding: '4px 8px',
            background: 'var(--bg-root)',
            border: '1px solid var(--border-default)',
            borderRadius: 3,
            color: 'var(--text-primary)',
            outline: 'none',
            fontFamily: 'var(--font-sans)',
          }}
        />
      </div>
      <div ref={listRef} style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
        {filtered.length === 0 && (
          <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
            No matches
          </div>
        )}
        {(() => {
          // Flat cursor index across groups so keyboard nav moves continuously.
          let idx = -1
          return groups.map((g, gi) => (
            <div
              key={gi}
              style={{
                borderTop: gi > 0 ? '1px solid var(--border-subtle)' : undefined,
                marginTop: gi > 0 ? 4 : 0,
                paddingTop: gi > 0 ? 4 : 0,
              }}
            >
              {g.label && (
                <div style={{
                  fontSize: 9,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--text-muted)',
                  padding: '4px 12px',
                }}>
                  {g.label}
                </div>
              )}
              {g.items.map(opt => {
                idx++
                const highlighted = idx === cursor
                const checked = selected.includes(opt.name)
                return (
                  <PickerRow
                    key={opt.name}
                    option={opt}
                    checked={checked}
                    highlighted={highlighted}
                    onClick={() => onToggle(opt.name)}
                  />
                )
              })}
            </div>
          ))
        })()}
      </div>
      <div style={{
        padding: '6px 12px',
        borderTop: '1px solid var(--border-subtle)',
        fontSize: 10,
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-sans)',
      }}>
        ↑↓ navigate · ↵ toggle · esc close
      </div>
    </div>
  )
}

function PickerRow({
  option,
  checked,
  highlighted,
  onClick,
}: {
  option: PickerOption
  checked: boolean
  highlighted: boolean
  onClick: () => void
}) {
  const hasPct = option.pct !== undefined
  return (
    <div
      onClick={onClick}
      onMouseDown={e => e.preventDefault()}
      style={{
        display: 'flex',
        alignItems: hasPct ? 'flex-start' : 'center',
        gap: 8,
        padding: hasPct ? '6px 12px' : '4px 12px',
        cursor: 'pointer',
        background: highlighted ? 'var(--bg-hover)' : 'transparent',
      }}
    >
      <span style={{
        width: 12,
        height: 12,
        marginTop: hasPct ? 2 : 0,
        border: '1px solid var(--border-default)',
        borderRadius: 2,
        background: checked ? 'var(--text-primary)' : 'transparent',
        color: 'var(--bg-root)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 9,
        flexShrink: 0,
      }}>
        {checked && '✓'}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{
            fontSize: 12,
            fontWeight: 500,
            color: option.color ?? 'var(--text-primary)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {option.name}
          </span>
          {hasPct && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0 }}>
              {option.pct!.toFixed(1)}%
            </span>
          )}
        </div>
        {option.subtitle && (
          <span style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {option.subtitle}
          </span>
        )}
        {hasPct && (
          <div style={{ height: 3, background: 'var(--bg-hover)', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, option.pct!)}%`,
              height: '100%',
              background: 'var(--text-secondary)',
              opacity: 0.6,
            }} />
          </div>
        )}
      </div>
    </div>
  )
}

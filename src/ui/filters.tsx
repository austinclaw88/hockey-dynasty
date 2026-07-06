// Lightweight, instant position filter chips + name search, shared by the
// Roster and Free Agency tables.
import type { Player } from '../types'

export type PosFilterValue = 'ALL' | 'F' | 'D' | 'G'

const OPTS: PosFilterValue[] = ['ALL', 'F', 'D', 'G']
const LABEL: Record<PosFilterValue, string> = { ALL: 'All', F: 'F', D: 'D', G: 'G' }

/** True if a player passes the F/D/G position filter. */
export function matchesPos(p: Player, f: PosFilterValue): boolean {
  if (f === 'ALL') return true
  if (f === 'G') return p.pos === 'G'
  if (f === 'D') return p.pos === 'D'
  return p.pos === 'C' || p.pos === 'LW' || p.pos === 'RW'
}

export function PosFilter({ value, onChange }: { value: PosFilterValue; onChange: (v: PosFilterValue) => void }) {
  return (
    <div className="chip-row" role="tablist" aria-label="Position filter">
      {OPTS.map((f) => (
        <button
          key={f}
          type="button"
          className={`chip ${value === f ? 'active' : ''}`}
          aria-pressed={value === f}
          onClick={() => onChange(f)}
        >
          {LABEL[f]}
        </button>
      ))}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="text"
      className="search-input"
      value={value}
      placeholder={placeholder ?? 'Search'}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder ?? 'Search'}
    />
  )
}

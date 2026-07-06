// Pure display-formatting helpers. No game logic here.

/** "$13.25M" — money in millions, trimmed to at most 2 decimals. */
export function fmtM(m: number | undefined | null): string {
  if (m === undefined || m === null || Number.isNaN(m)) return '—'
  // Show up to 2 decimals but strip trailing zeros: 13 -> $13M, 13.25 -> $13.25M, 0.775 -> $0.78M
  const rounded = Math.round(m * 100) / 100
  const s = rounded.toFixed(2).replace(/\.?0+$/, '')
  return `$${s}M`
}

/** Wins-losses-otl record: "41-25-16". */
export function fmtRecord(w: number, l: number, otl: number): string {
  return `${w}-${l}-${otl}`
}

/** Signed integer with explicit + for positives: +12 / -3 / 0 (plus/minus). */
export function fmtSigned(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '0'
  return n > 0 ? `+${n}` : `${n}`
}

/** Goalie GAA to 2 decimals. */
export function fmtGaa(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—'
  return n.toFixed(2)
}

/** Save percentage as ".912". */
export function fmtSvPct(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—'
  // engine may store either 0.912 or 91.2 — normalize to a 0..1 fraction.
  const frac = n > 1 ? n / 100 : n
  return frac.toFixed(3).replace(/^0/, '')
}

/**
 * OVR badge CSS class by rating tier.
 * 90+ gold, 85+ green, 80+ teal, 75+ gray, <75 dim.
 */
export function ovrClass(overall: number): string {
  if (overall >= 90) return 'ovr ovr-gold'
  if (overall >= 85) return 'ovr ovr-green'
  if (overall >= 80) return 'ovr ovr-teal'
  if (overall >= 75) return 'ovr ovr-gray'
  return 'ovr ovr-dim'
}

/** Human label for a season start year: 2025 -> "2025-26". */
export function seasonLabel(startYear: number): string {
  const next = (startYear + 1) % 100
  return `${startYear}-${next.toString().padStart(2, '0')}`
}

/** Potential-vs-overall arrow: ▲ green if room to grow, ● flat if capped. */
export function potArrow(overall: number, potential: number): { symbol: string; cls: string } {
  const gap = potential - overall
  if (gap >= 6) return { symbol: '▲▲', cls: 'pot-high' }
  if (gap >= 1) return { symbol: '▲', cls: 'pot-up' }
  return { symbol: '●', cls: 'pot-flat' }
}

/** Ordinal: 1 -> "1st", 2 -> "2nd". */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Position group for grouping/sorting: forwards together, then D, then G. */
export function posGroup(pos: string): number {
  if (pos === 'C' || pos === 'LW' || pos === 'RW') return 0
  if (pos === 'D') return 1
  return 2
}

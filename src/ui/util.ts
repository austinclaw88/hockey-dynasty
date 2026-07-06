// Game-state derived helpers used across screens (pure, read-only).
import type { GameState, Player, TeamState, Game, Division } from '../types'
import { SALARY_CAP } from '../types'

/** Average of the top-N overalls on a roster — a quick team-strength proxy. */
export function teamOverall(roster: Player[], topN = 20): number {
  if (roster.length === 0) return 0
  const sorted = [...roster].map((p) => p.overall).sort((a, b) => b - a)
  const slice = sorted.slice(0, Math.min(topN, sorted.length))
  const sum = slice.reduce((a, b) => a + b, 0)
  return Math.round((sum / slice.length) * 10) / 10
}

/** Sum of roster cap hits ($M). Prospects don't count against the cap. */
export function rosterCapHit(roster: Player[]): number {
  const sum = roster.reduce((a, p) => a + (p.contract?.capHit ?? 0), 0)
  return Math.round(sum * 100) / 100
}

/** Salary cap for a given season start year (falls back to nearest known). */
export function capForYear(year: number): number {
  if (SALARY_CAP[year] !== undefined) return SALARY_CAP[year]
  const years = Object.keys(SALARY_CAP).map(Number)
  const max = Math.max(...years)
  return year > max ? SALARY_CAP[max] : SALARY_CAP[Math.min(...years)]
}

export interface PlayerRef {
  player: Player
  team?: string
  /** where the player currently lives */
  where: 'roster' | 'prospect' | 'freeAgent' | 'draft'
}

/** Build a lookup of every known player id -> ref, for cheap name/stat resolution. */
export function buildPlayerIndex(s: GameState): Map<string, PlayerRef> {
  const idx = new Map<string, PlayerRef>()
  for (const abbrev of Object.keys(s.teams)) {
    const t = s.teams[abbrev]
    for (const p of t.roster) idx.set(p.id, { player: p, team: abbrev, where: 'roster' })
    for (const p of t.prospects) idx.set(p.id, { player: p, team: abbrev, where: 'prospect' })
  }
  for (const fa of s.freeAgents) idx.set(fa.id, { player: fa, where: 'freeAgent' })
  for (const p of s.draftClass) idx.set(p.id, { player: p, where: 'draft' })
  return idx
}

export function isHealthy(p: Player): boolean {
  return !p.injuryWeeks || p.injuryWeeks <= 0
}

export interface Lines {
  forwards: Player[][] // 4 lines of up to 3
  defense: Player[][] // 3 pairs of up to 2
  goalies: Player[] // up to 2
  scratches: Player[]
}

/**
 * UI-only auto line assignment for display. The engine picks the ACTIVE
 * players for sim internally; this mirrors the "best by overall" heuristic
 * purely so the Roster screen can show L1-L4 / P1-P3 / G1-G2.
 */
export function autoLines(roster: Player[]): Lines {
  const healthy = roster.filter(isHealthy)
  const fwd = healthy
    .filter((p) => p.pos === 'C' || p.pos === 'LW' || p.pos === 'RW')
    .sort((a, b) => b.overall - a.overall)
  const def = healthy.filter((p) => p.pos === 'D').sort((a, b) => b.overall - a.overall)
  const goalies = healthy.filter((p) => p.pos === 'G').sort((a, b) => b.overall - a.overall).slice(0, 2)

  const topF = fwd.slice(0, 12)
  const topD = def.slice(0, 6)
  const usedIds = new Set([...topF, ...topD, ...goalies].map((p) => p.id))
  const scratches = roster.filter((p) => !usedIds.has(p.id))

  const forwards: Player[][] = [[], [], [], []]
  topF.forEach((p, i) => forwards[Math.floor(i / 3)]?.push(p))
  const defense: Player[][] = [[], [], []]
  topD.forEach((p, i) => defense[Math.floor(i / 2)]?.push(p))

  return { forwards, defense, goalies, scratches }
}

export function nextGames(s: GameState, team: string, count: number): Game[] {
  return s.schedule
    .filter((g) => !g.played && (g.home === team || g.away === team) && g.day >= s.day)
    .sort((a, b) => a.day - b.day)
    .slice(0, count)
}

export function recentGames(s: GameState, team: string, count: number): Game[] {
  return s.schedule
    .filter((g) => g.played && (g.home === team || g.away === team))
    .sort((a, b) => b.day - a.day)
    .slice(0, count)
}

export const DIVISIONS: Division[] = ['Atlantic', 'Metropolitan', 'Central', 'Pacific']

export function divisionsByConference(): Record<'East' | 'West', Division[]> {
  return {
    East: ['Atlantic', 'Metropolitan'],
    West: ['Central', 'Pacific'],
  }
}

/** Approximate calendar day label (Oct 8 -> Apr 10 over ~185 days). */
export function dayLabel(day: number): string {
  // Season starts Oct 8. Each index ~= 1 calendar day.
  const start = new Date(2025, 9, 8) // month 9 = October
  const d = new Date(start.getTime() + day * 24 * 3600 * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Count roster composition for legality display. */
export function rosterCounts(roster: Player[]): { f: number; d: number; g: number; total: number } {
  let f = 0
  let d = 0
  let g = 0
  for (const p of roster) {
    if (p.pos === 'D') d++
    else if (p.pos === 'G') g++
    else f++
  }
  return { f, d, g, total: roster.length }
}

/** Cap-bar zone class from usage ratio. */
export function capZone(used: number, cap: number): 'ok' | 'warn' | 'over' {
  if (used > cap) return 'over'
  if (used > cap * 0.92) return 'warn'
  return 'ok'
}

export function findTeamState(s: GameState, team: string): TeamState | undefined {
  return s.teams[team]
}

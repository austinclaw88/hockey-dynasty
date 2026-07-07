// Game-state derived helpers used across screens (pure, read-only).
import type { GameState, Player, TeamState, Game, Division } from '../types'
import { SALARY_CAP, START_YEAR } from '../types'

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

/** One forward-line slot: which position it represents and who (if anyone) fills it. */
export interface ForwardSlot {
  slot: 'LW' | 'C' | 'RW'
  player: Player | null
}

export interface Lines {
  /** 4 lines, each ordered [LW, C, RW] */
  forwards: ForwardSlot[][]
  defense: Player[][] // 3 pairs of up to 2
  goalies: Player[] // up to 2
  scratches: Player[]
}

/**
 * UI-only auto line assignment for display. The engine picks the ACTIVE
 * players for sim internally; this mirrors the "best by overall" heuristic
 * purely so the Roster screen can show L1-L4 / P1-P3 / G1-G2.
 *
 * Forward lines are assembled position-aware and rendered LW – C – RW:
 * each line takes the best remaining true C for the middle, best LW / RW for
 * the wings, and falls back gracefully (a C or off-wing can fill a wing; a
 * wing fills C only when no centre remains).
 */
export function autoLines(roster: Player[]): Lines {
  const healthy = roster.filter(isHealthy)
  const byOvr = (a: Player, b: Player) => b.overall - a.overall
  const fwd = healthy
    .filter((p) => p.pos === 'C' || p.pos === 'LW' || p.pos === 'RW')
    .sort(byOvr)
  const def = healthy.filter((p) => p.pos === 'D').sort(byOvr)
  const goalies = healthy.filter((p) => p.pos === 'G').sort(byOvr).slice(0, 2)

  const dressed = fwd.slice(0, 12)
  const topD = def.slice(0, 6)
  const usedIds = new Set([...dressed, ...topD, ...goalies].map((p) => p.id))
  const scratches = roster.filter((p) => !usedIds.has(p.id))

  // Position-aware forward assembly.
  const used = new Set<string>()
  const cPool = dressed.filter((p) => p.pos === 'C')
  const lwPool = dressed.filter((p) => p.pos === 'LW')
  const rwPool = dressed.filter((p) => p.pos === 'RW')
  const take = (pool: Player[]): Player | null => {
    for (const p of pool) {
      if (!used.has(p.id)) {
        used.add(p.id)
        return p
      }
    }
    return null
  }
  // Fallback fill from whoever's left. For a wing slot, prefer a spare wing/
  // off-wing over stealing a centre; for a centre slot only wings remain.
  const takeRemaining = (preferWing: boolean): Player | null => {
    const rem = dressed.filter((p) => !used.has(p.id)).sort(byOvr)
    const primary = preferWing ? rem.filter((p) => p.pos !== 'C') : rem
    const pick = (primary.length > 0 ? primary : rem)[0]
    if (pick) {
      used.add(pick.id)
      return pick
    }
    return null
  }

  const forwards: ForwardSlot[][] = []
  for (let i = 0; i < 4; i++) {
    const c = take(cPool) ?? takeRemaining(false)
    const lw = take(lwPool) ?? takeRemaining(true)
    const rw = take(rwPool) ?? takeRemaining(true)
    forwards.push([
      { slot: 'LW', player: lw },
      { slot: 'C', player: c },
      { slot: 'RW', player: rw },
    ])
  }

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
  const start = new Date(START_YEAR, 9, 8) // month 9 = October
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

/** One resolved goal line for a box score. */
export interface BoxGoalLine {
  team: string
  scorer: string
  assists: string[]
}

/** Resolve a player id to a display name using the full player index. */
export function nameFor(idx: Map<string, PlayerRef>, id: string, s?: GameState): string {
  return idx.get(id)?.player.name ?? s?.names?.[id] ?? prettifyId(id)
}

/** Build the resolved, in-order goal lines for a game's box score. */
export function boxScoreLines(s: GameState, game: Game, idx: Map<string, PlayerRef>): BoxGoalLine[] {
  if (!game.goals) return []
  return game.goals.map((ev) => ({
    team: ev.team,
    scorer: nameFor(idx, ev.scorerId, s),
    assists: ev.assistIds.map((a) => nameFor(idx, a)),
  }))
}

/** One goal resolved to ids + names, keeping scoring-order index and period. */
export interface ResolvedGoal {
  /** Scoring-order index within the game (0-based). */
  order: number
  team: string
  scorerId: string
  scorerName: string
  assists: { id: string; name: string }[]
  /** 1-3, 4 = OT; undefined on legacy saves. */
  period?: number
}

/** Human labels for the period groupings. */
export const PERIOD_LABEL: Record<number, string> = {
  1: '1st Period',
  2: '2nd Period',
  3: '3rd Period',
  4: 'Overtime',
}

export interface PeriodGroup {
  /** Period number, or null for the ungrouped (legacy, no-period) bucket. */
  period: number | null
  goals: ResolvedGoal[]
}

/** Resolve every goal in a game to ids + names, preserving scoring order. */
export function resolveGoals(game: Game, idx: Map<string, PlayerRef>): ResolvedGoal[] {
  if (!game.goals) return []
  return game.goals.map((ev, i) => ({
    order: i,
    team: ev.team,
    scorerId: ev.scorerId,
    scorerName: nameFor(idx, ev.scorerId),
    assists: ev.assistIds.map((a) => ({ id: a, name: nameFor(idx, a) })),
    period: ev.period,
  }))
}

/**
 * Group resolved goals by period. If no goal carries a period (legacy save),
 * returns a single ungrouped bucket (period: null). Otherwise returns periods
 * 1..max (at least 1-3), plus a trailing null bucket if some goals lack one.
 */
export function groupGoalsByPeriod(goals: ResolvedGoal[]): PeriodGroup[] {
  const anyPeriod = goals.some((g) => g.period != null)
  if (!anyPeriod) return goals.length > 0 ? [{ period: null, goals }] : []
  const maxP = Math.max(3, ...goals.map((g) => g.period ?? 0))
  const groups: PeriodGroup[] = []
  for (let p = 1; p <= maxP; p++) groups.push({ period: p, goals: goals.filter((g) => g.period === p) })
  const noPeriod = goals.filter((g) => g.period == null)
  if (noPeriod.length > 0) groups.push({ period: null, goals: noPeriod })
  return groups
}

/** Cumulative [away, home] score after all goals up to and including `period`. */
export function scoreThroughPeriod(goals: ResolvedGoal[], away: string, home: string, period: number): [number, number] {
  let a = 0
  let h = 0
  for (const g of goals) {
    if ((g.period ?? 3) > period) continue
    if (g.team === away) a++
    else if (g.team === home) h++
  }
  return [a, h]
}

/** One row of a player's per-game scoring log (games where they recorded a point). */
export interface ScoringLogRow {
  game: Game
  /** Opponent abbrev from the player's perspective that game. */
  opp: string
  home: boolean
  g: number
  a: number
}

/**
 * Scan the season's played games for every game in which `playerId` scored or
 * assisted, newest first. Games with no points are omitted. Cheap enough to
 * memoize per (schedule, playerId).
 */
export function buildScoringLog(s: GameState, playerId: string): ScoringLogRow[] {
  const rows: ScoringLogRow[] = []
  for (const game of s.schedule) {
    if (!game.played || !game.goals || game.goals.length === 0) continue
    let g = 0
    let a = 0
    let team: string | undefined
    for (const ev of game.goals) {
      const scored = ev.scorerId === playerId
      const assisted = ev.assistIds.includes(playerId)
      if (scored) g++
      if (assisted) a++
      if ((scored || assisted) && !team) team = ev.team
    }
    if (g === 0 && a === 0 || !team) continue
    const home = game.home === team
    rows.push({ game, opp: home ? game.away : game.home, home, g, a })
  }
  return rows.sort((x, y) => y.game.day - x.game.day)
}

/** Last-resort display name from an id slug like 'BUF-thompson2' -> 'Thompson'. */
export function prettifyId(id: string): string {
  const part = id.split('-').slice(1).join('-').replace(/\d+$/, '')
  if (!part) return 'Unknown'
  return part.charAt(0).toUpperCase() + part.slice(1)
}

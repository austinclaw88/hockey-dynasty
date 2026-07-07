// Small shared helpers, player predicates, and the internal extended-state type.
import type { GameState, Player, SeasonStatLine, TeamState, Position, DraftClassFile } from '../types.ts'
import { SALARY_CAP, START_YEAR, SEASONS_TOTAL } from '../types.ts'

// ---- internal extended state ---------------------------------------------
// GameState is frozen, but we need a couple of transient bookkeeping fields
// that must survive serialization (draft results shown by the UI). We attach
// them via an extended alias; extra props round-trip through JSON harmlessly.
export interface DraftResult {
  pick: number
  team: string
  playerName: string
}
export interface EngineExtras {
  _draftResults?: DraftResult[]
  /** Monotonic counter backing PendingOffer.id so ids never collide across drops. */
  _nextOfferId?: number
  /** Monotonic counter backing PendingOfferSheet.id so ids never collide. */
  _nextSheetId?: number
  /** Real projected draft class (data/draft-2027.json) threaded in via newGame,
   *  used to seed the FIRST in-game entry draft. Undefined/empty => generated. */
  _draft2027?: DraftClassFile
  /** Recent fantasy-draft picks (for the board's "recent" feed). */
  _fantasyResults?: DraftResult[]
  /** Season year in which AI mid-season contract extensions have already run
   *  (so the pass fires at most once per regular season). */
  _extSeason?: number
}
export type ES = GameState & EngineExtras

/** Goalie stat line carries raw cumulative goals-against / shots to recompute
 *  GAA and SV% exactly each game. Extra props are ignored by the frozen type. */
export interface GLine extends SeasonStatLine {
  _ga?: number
  _sa?: number
}

// ---- player predicates ----------------------------------------------------
export const isForward = (p: Player): boolean => p.pos === 'C' || p.pos === 'LW' || p.pos === 'RW'
export const isDefense = (p: Player): boolean => p.pos === 'D'
export const isGoalie = (p: Player): boolean => p.pos === 'G'
export const isHealthy = (p: Player): boolean => !p.injuryWeeks || p.injuryWeeks <= 0
export const isActivePlayer = (p: Player): boolean => !p.retired

// ---- math -----------------------------------------------------------------
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}
export function avg(nums: number[], fallback = 70): number {
  if (nums.length === 0) return fallback
  let s = 0
  for (const n of nums) s += n
  return s / nums.length
}
/** Weighted average of the first `boostN` items counted `boostW`x. */
export function weightedAvg(nums: number[], boostN: number, boostW: number, fallback = 70): number {
  if (nums.length === 0) return fallback
  let sum = 0
  let wsum = 0
  for (let i = 0; i < nums.length; i++) {
    const w = i < boostN ? boostW : 1
    sum += nums[i] * w
    wsum += w
  }
  return sum / wsum
}

// ---- state access ---------------------------------------------------------
export function ext(s: GameState): ES {
  return s as ES
}
export function currentCap(seasonYear: number): number {
  return SALARY_CAP[seasonYear] ?? SALARY_CAP[START_YEAR + SEASONS_TOTAL - 1]
}
export function nextCap(seasonYear: number): number {
  return SALARY_CAP[seasonYear + 1] ?? currentCap(seasonYear)
}
/** Cap basis that matches what the engine ENFORCES for the current phase:
 *  offseason signings/trades count against NEXT season's cap, everything else
 *  against the current season's cap. Keeps UI space == engine space. */
export function capForPhase(s: GameState): number {
  return s.phase === 'offseason' ? nextCap(s.seasonYear) : currentCap(s.seasonYear)
}
export function teamCapUsed(team: TeamState): number {
  let total = 0
  for (const p of team.roster) total += p.contract?.capHit ?? 0
  return Math.round(total * 1000) / 1000
}
/** Cap committed for the NEXT season: like teamCapUsed but EXCLUDES contracts
 *  that have already expired (yearsLeft <= 0). During the offseason 'resign' step
 *  a team's expiring players still sit on the roster carrying their old cap hit
 *  even though those dollars are gone — counting them would double-charge the cap
 *  and make re-signing below the old AAV wrongly INCREASE displayed space. All
 *  offseason-phase cap math uses this; in-season keeps teamCapUsed (no expired
 *  deals exist mid-season). */
export function committedCapUsed(team: TeamState): number {
  let total = 0
  for (const p of team.roster) {
    if (p.contract && p.contract.yearsLeft <= 0) continue
    total += p.contract?.capHit ?? 0
  }
  return Math.round(total * 1000) / 1000
}
/** Cap USED on the same basis the engine enforces for the current phase:
 *  offseason excludes expired deals (committedCapUsed), everything else counts
 *  every roster contract (teamCapUsed). Mirrors capForPhase for the ceiling. */
export function capUsedForPhase(s: GameState, team: TeamState): number {
  return s.phase === 'offseason' ? committedCapUsed(team) : teamCapUsed(team)
}

/** Count roster by position group. */
export function rosterCounts(team: TeamState): { f: number; d: number; g: number; total: number } {
  let f = 0
  let d = 0
  let g = 0
  for (const p of team.roster) {
    if (p.pos === 'D') d++
    else if (p.pos === 'G') g++
    else f++
  }
  return { f, d, g, total: team.roster.length }
}

/** The stat store for the CURRENT phase: playoff games accrue into a SEPARATE
 *  `s.playoffStats` map so the 82-game regular-season `s.stats` (and everything
 *  downstream — awards, leaders, careers) never inflates past 82 GP. Anything
 *  outside the playoffs writes to `s.stats`. */
export function statStore(s: GameState): Record<string, SeasonStatLine> {
  if (s.phase === 'playoffs') {
    if (!s.playoffStats) s.playoffStats = {}
    return s.playoffStats
  }
  return s.stats
}

export function ensureStat(s: GameState, id: string): SeasonStatLine {
  const store = statStore(s)
  let line = store[id]
  if (!line) {
    line = { playerId: id, gp: 0, goals: 0, assists: 0, points: 0, plusMinus: 0, pim: 0 }
    store[id] = line
  }
  return line
}

export function findTeamOfPlayer(s: GameState, id: string): string | undefined {
  for (const abbr of Object.keys(s.teams)) {
    const t = s.teams[abbr]
    if (t.roster.some((p) => p.id === id) || t.prospects.some((p) => p.id === id)) return abbr
  }
  return undefined
}

/** Drop trade-block ids that no longer belong to the user's team — traded away
 *  or retired. Both NHL-roster players and prospects may be shopped, so a sent-
 *  down/called-up player stays on the block. Safe after any roster change. */
export function pruneTradeBlock(s: GameState): void {
  if (!s.tradeBlock || s.tradeBlock.length === 0) return
  const team = s.teams[s.userTeam]
  if (!team) return
  const ids = new Set([...team.roster, ...team.prospects].map((p) => p.id))
  s.tradeBlock = s.tradeBlock.filter((id) => ids.has(id))
}

export function pushNews(s: GameState, text: string): void {
  s.news.unshift({ day: s.day, seasonYear: s.seasonYear, text })
  // Cap the log so saves stay small.
  if (s.news.length > 400) s.news.length = 400
}

export const POS_LIST: Position[] = ['C', 'LW', 'RW', 'D', 'G']

// Small shared helpers, player predicates, and the internal extended-state type.
import type { GameState, Player, SeasonStatLine, TeamState, Position } from '../types.ts'
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
export function teamCapUsed(team: TeamState): number {
  let total = 0
  for (const p of team.roster) total += p.contract?.capHit ?? 0
  return Math.round(total * 1000) / 1000
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

export function ensureStat(s: GameState, id: string): SeasonStatLine {
  let line = s.stats[id]
  if (!line) {
    line = { playerId: id, gp: 0, goals: 0, assists: 0, points: 0, plusMinus: 0, pim: 0 }
    s.stats[id] = line
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

export function pushNews(s: GameState, text: string): void {
  s.news.unshift({ day: s.day, seasonYear: s.seasonYear, text })
  // Cap the log so saves stay small.
  if (s.news.length > 400) s.news.length = 400
}

export const POS_LIST: Position[] = ['C', 'LW', 'RW', 'D', 'G']

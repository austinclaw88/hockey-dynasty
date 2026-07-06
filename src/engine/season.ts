// Regular-season day driver: sims games day-by-day, heals injuries weekly,
// fires occasional AI-AI trades, and transitions into the playoffs.
import type { GameState } from '../types.ts'
import type { Rng } from './rng.ts'
import { simDay, healInjuries } from './sim.ts'
import { maybeAiAiTrade, maybeGenerateUserOffers, pruneOffers } from './trades.ts'
import { startPlayoffs } from './playoffs.ts'

function lastGameDay(s: GameState): number {
  let m = 0
  for (const g of s.schedule) if (g.day > m) m = g.day
  return m
}

function allPlayed(s: GameState): boolean {
  for (const g of s.schedule) if (!g.played) return false
  return true
}

/** Advance the regular season by `days` calendar days. */
export function advanceRegularDays(s: GameState, days: number, rng: Rng): void {
  if (s.phase !== 'regular') return
  const target = Math.min(s.day + days, lastGameDay(s) + 1)
  for (let d = s.day; d < target; d++) {
    simDay(s, d, rng)
    if ((d + 1) % 7 === 0) healInjuries(s)
    maybeAiAiTrade(s, rng)
    maybeGenerateUserOffers(s, rng, d, false)
  }
  s.day = target
  pruneOffers(s) // expire offers past the deadline / older than ~14 days
  if (allPlayed(s)) startPlayoffs(s, rng)
}

export function advanceToEndOfSeason(s: GameState, rng: Rng): void {
  if (s.phase !== 'regular') return
  advanceRegularDays(s, lastGameDay(s) + 1 - s.day, rng)
}

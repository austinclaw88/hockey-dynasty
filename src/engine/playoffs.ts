// Playoff bracket: seeding into an NHL-style bracket, best-of-7 series.
import type { GameState, PlayoffSeries, Conference, StandingsRow } from '../types.ts'
import type { Rng } from './rng.ts'
import { computeStandings } from './standings.ts'
import { playoffSeeds, type Seed } from './standings.ts'
import { simSeries } from './sim.ts'

function ptsMap(s: GameState): Record<string, number> {
  const rows = computeStandings(s)
  const m: Record<string, number> = {}
  for (const abbr of Object.keys(rows)) {
    const r: StandingsRow = rows[abbr]
    m[abbr] = r.pts * 1000 + (r.gf - r.ga) // pts with GD tiebreak baked in
  }
  return m
}

function series(round: number, a: string, b: string, pts: Record<string, number>): PlayoffSeries {
  const high = pts[a] >= pts[b] ? a : b
  const low = high === a ? b : a
  return { round, high, low, highWins: 0, lowWins: 0 }
}

/** Build the 8 first-round series in bracket order (consecutive pairs meet next). */
export function startPlayoffs(s: GameState, rng: Rng): void {
  const seeds = playoffSeeds(s)
  const pts = ptsMap(s)
  const all: PlayoffSeries[] = []
  for (const conf of ['East', 'West'] as Conference[]) {
    const cs = seeds[conf]
    const byCode = (c: string): Seed | undefined => cs.find((x) => x.code === c)
    const divWinners = cs.filter((x) => x.code.endsWith('1') && !x.code.startsWith('WC'))
    // topWinner = division winner with the better record.
    const [w0, w1] = divWinners
    const topWinner = pts[w0.team] >= pts[w1.team] ? w0 : w1
    const otherWinner = topWinner === w0 ? w1 : w0
    const wc1 = byCode('WC1')!
    const wc2 = byCode('WC2')!
    const topDiv = topWinner.code[0]
    const otherDiv = otherWinner.code[0]
    const topD2 = cs.find((x) => x.code === `${topDiv}2`)!
    const topD3 = cs.find((x) => x.code === `${topDiv}3`)!
    const otherD2 = cs.find((x) => x.code === `${otherDiv}2`)!
    const otherD3 = cs.find((x) => x.code === `${otherDiv}3`)!

    all.push(series(1, topWinner.team, wc2.team, pts))
    all.push(series(1, topD2.team, topD3.team, pts))
    all.push(series(1, otherWinner.team, wc1.team, pts))
    all.push(series(1, otherD2.team, otherD3.team, pts))
  }
  s.playoffs = all
  s.phase = 'playoffs'
}

/** Sim the current round; build the next round. Returns true when the Cup is won. */
export function advancePlayoffRound(s: GameState, rng: Rng): boolean {
  if (!s.playoffs || s.playoffs.length === 0) return false
  const maxRound = Math.max(...s.playoffs.map((x) => x.round))
  const cur = s.playoffs.filter((x) => x.round === maxRound)
  const pts = ptsMap(s)

  for (const ser of cur) {
    if (ser.winner) continue
    const res = simSeries(s, ser.high, ser.low, rng)
    ser.highWins = res.highWins
    ser.lowWins = res.lowWins
    ser.winner = res.winner
  }

  if (maxRound >= 4) return true // Cup decided.

  // Build next round from consecutive winner pairs.
  const winners = cur.map((x) => x.winner!)
  const next: PlayoffSeries[] = []
  for (let i = 0; i < winners.length; i += 2) {
    next.push(series(maxRound + 1, winners[i], winners[i + 1], pts))
  }
  s.playoffs.push(...next)
  return false
}

export function cupResult(s: GameState): { winner: string; runnerUp: string } | null {
  if (!s.playoffs) return null
  const final = s.playoffs.find((x) => x.round === 4 && x.winner)
  if (!final) return null
  return { winner: final.winner!, runnerUp: final.winner === final.high ? final.low : final.high }
}

/** How far a team advanced, as a human-readable string. */
export function userPlayoffFinish(s: GameState, team: string): string | null {
  if (!s.playoffs) return null
  const roundNames = ['', 'Round 1', 'Round 2', 'Conference Final', 'Stanley Cup Final']
  let last: PlayoffSeries | undefined
  for (const ser of s.playoffs) {
    if (ser.high === team || ser.low === team) last = ser
  }
  if (!last) return null
  if (last.winner === team && last.round === 4) return 'Won the Stanley Cup'
  if (last.winner === team) return `Advanced past ${roundNames[last.round]}`
  return `Lost in ${roundNames[last.round]}`
}

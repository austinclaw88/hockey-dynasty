// Playoff bracket: seeding into an NHL-style bracket, best-of-7 series played
// game-by-game with the full game-sim machinery (box scores + stat attribution).
import type { GameState, PlayoffSeries, PlayoffGame, Conference, StandingsRow } from '../types.ts'
import type { Rng } from './rng.ts'
import { computeStandings } from './standings.ts'
import { playoffSeeds, type Seed } from './standings.ts'
import { simPlayoffGameResult } from './sim.ts'

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
  s.playoffStats = {} // playoff attribution accrues here, separate from the 82-game s.stats
  s.pendingOffers = [] // regular-season trade offers expire at season end
}

/** Games played so far in a series (robust for legacy saves that lack `games`). */
function gamesPlayed(ser: PlayoffSeries): number {
  return ser.games ? ser.games.length : ser.highWins + ser.lowWins
}

/** Play the NEXT game of one (undecided) series: appends to `ser.games`, updates
 *  the win totals, and sets `winner` at 4. Home ice alternates 2-2-1-1-1 with the
 *  higher seed opening at home (games 1,2,5,7 → indices 0,1,4,6). */
function playSeriesGame(s: GameState, ser: PlayoffSeries, rng: Rng): void {
  const g = gamesPlayed(ser)
  const highHome = g === 0 || g === 1 || g === 4 || g === 6
  const home = highHome ? ser.high : ser.low
  const away = highHome ? ser.low : ser.high
  const res = simPlayoffGameResult(s, home, away, rng)
  const pg: PlayoffGame = { home, homeGoals: res.homeGoals, awayGoals: res.awayGoals, endType: res.endType, goals: res.goals }
  if (!ser.games) ser.games = []
  ser.games.push(pg)
  const highGoals = home === ser.high ? res.homeGoals : res.awayGoals
  const lowGoals = home === ser.low ? res.homeGoals : res.awayGoals
  if (highGoals > lowGoals) ser.highWins += 1
  else ser.lowWins += 1
  if (ser.highWins >= 4) ser.winner = ser.high
  else if (ser.lowWins >= 4) ser.winner = ser.low
}

/** Seed the round after `round` from its consecutive winner pairs. */
function seedNextRound(s: GameState, round: number, cur: PlayoffSeries[]): void {
  const pts = ptsMap(s)
  const winners = cur.map((x) => x.winner!)
  const next: PlayoffSeries[] = []
  for (let i = 0; i < winners.length; i += 2) {
    next.push(series(round + 1, winners[i], winners[i + 1], pts))
  }
  s.playoffs!.push(...next)
}

/** One "playoff night": play exactly ONE game in every undecided series of the
 *  current round. When the round is already complete, this call instead seeds the
 *  next round (or reports the Cup when round 4 is done). Returns true when the
 *  Cup has just been decided. */
export function playPlayoffNight(s: GameState, rng: Rng): boolean {
  if (!s.playoffs || s.playoffs.length === 0) return false
  const maxRound = Math.max(...s.playoffs.map((x) => x.round))
  const cur = s.playoffs.filter((x) => x.round === maxRound)
  const undecided = cur.filter((x) => !x.winner)
  if (undecided.length === 0) {
    // Round complete — seed the next round, or the Cup is already won.
    if (maxRound >= 4) return true
    seedNextRound(s, maxRound, cur)
    return false
  }
  for (const ser of undecided) playSeriesGame(s, ser, rng)
  // A final that just concluded ends the playoffs immediately.
  return maxRound >= 4 && !!cur[0].winner
}

/** Sim the entire current round (looping playoff nights), then seed the next
 *  round. Returns true when the Cup is won. */
export function advancePlayoffRound(s: GameState, rng: Rng): boolean {
  if (!s.playoffs || s.playoffs.length === 0) return false
  const round = Math.max(...s.playoffs.map((x) => x.round))
  let guard = 0
  while (guard++ < 200) {
    const cur = s.playoffs.filter((x) => x.round === round)
    const undecided = cur.filter((x) => !x.winner)
    if (undecided.length === 0) break
    for (const ser of undecided) playSeriesGame(s, ser, rng)
  }
  if (round >= 4) return true // Cup decided.
  seedNextRound(s, round, s.playoffs.filter((x) => x.round === round))
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

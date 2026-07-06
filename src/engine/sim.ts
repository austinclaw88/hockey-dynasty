// Statistical game simulation with player-level attribution. No play-by-play.
import type { GameState, Game, Player, TeamState } from '../types.ts'
import type { Rng } from './rng.ts'
import {
  clamp,
  weightedAvg,
  avg,
  isForward,
  isDefense,
  isGoalie,
  isHealthy,
  ensureStat,
  pushNews,
  type GLine,
} from './helpers.ts'

interface TeamGameCtx {
  off: number
  def: number
  goalie: Player | null
  scorers: Player[] // active skaters used for attribution + GP
}

function sortedByOverall(players: Player[]): Player[] {
  return [...players].sort((a, b) => b.overall - a.overall)
}

/** Roster-derived offense/defense ratings from the best healthy players. */
function buildCtx(team: TeamState, rng: Rng): TeamGameCtx {
  const healthy = team.roster.filter(isHealthy)
  const fwd = sortedByOverall(healthy.filter(isForward))
  const def = sortedByOverall(healthy.filter(isDefense))
  let goalies = sortedByOverall(healthy.filter(isGoalie))
  if (goalies.length === 0) goalies = sortedByOverall(team.roster.filter(isGoalie)) // emergency

  const top9F = fwd.slice(0, 9).map((p) => p.overall)
  const top4D = def.slice(0, 4).map((p) => p.overall)
  const top6D = def.slice(0, 6).map((p) => p.overall)
  const top12F = fwd.slice(0, 12).map((p) => p.overall)

  const off = 0.65 * weightedAvg(top9F, 3, 2) + 0.35 * avg(top4D)
  const defRating = 0.55 * avg(top6D) + 0.45 * avg(top12F)

  // Goalie: backup starts ~25% of games when available.
  let goalie: Player | null = goalies[0] ?? null
  if (goalies.length > 1 && rng.chance(0.25)) goalie = goalies[1]

  const scorers = [...fwd.slice(0, 12), ...def.slice(0, 6)]
  return { off, def: defRating, goalie, scorers }
}

const LEAGUE_MEAN = 3.05

function expectedGoals(offA: number, defB: number, goalieB: number, home: boolean): number {
  let xg = LEAGUE_MEAN * Math.pow(1.1, (offA - defB) / 6) * Math.pow(1.08, (78 - goalieB) / 6)
  if (home) xg *= 1.04
  return clamp(xg, 1.4, 5.2)
}

/** Weighted scorer pick: (overall-55)^2, forwards 4x defense. */
function pickScorer(scorers: Player[], rng: Rng, exclude: Set<string>): Player | null {
  let total = 0
  const weights: number[] = []
  for (const p of scorers) {
    if (exclude.has(p.id)) {
      weights.push(0)
      continue
    }
    const base = Math.max(1, p.overall - 55)
    const w = base * base * (isForward(p) ? 4 : 1)
    weights.push(w)
    total += w
  }
  if (total <= 0) return null
  let r = rng.float(0, total)
  for (let i = 0; i < scorers.length; i++) {
    if (r < weights[i]) return scorers[i]
    r -= weights[i]
  }
  return null
}

function attributeGoals(s: GameState, ctx: TeamGameCtx, conceding: TeamGameCtx, goals: number, rng: Rng): void {
  for (let g = 0; g < goals; g++) {
    const exclude = new Set<string>()
    const scorer = pickScorer(ctx.scorers, rng, exclude)
    if (!scorer) continue
    exclude.add(scorer.id)
    const sl = ensureStat(s, scorer.id)
    sl.goals++
    sl.points++
    sl.plusMinus++
    // 0-2 assists
    const nAssists = rng.next() < 0.15 ? 0 : rng.next() < 0.55 ? 2 : 1
    for (let a = 0; a < nAssists; a++) {
      const helper = pickScorer(ctx.scorers, rng, exclude)
      if (!helper) break
      exclude.add(helper.id)
      const hl = ensureStat(s, helper.id)
      hl.assists++
      hl.points++
      hl.plusMinus++
    }
    // Conceding team: charge a few on-ice skaters -1.
    const onIce = rng.shuffle([...conceding.scorers]).slice(0, Math.min(3, conceding.scorers.length))
    for (const p of onIce) ensureStat(s, p.id).plusMinus--
  }
}

function recordGoalie(s: GameState, goalie: Player | null, ga: number, result: 'W' | 'L' | 'OTL', rng: Rng): void {
  if (!goalie) return
  const line = ensureStat(s, goalie.id) as GLine
  const sa = Math.max(ga, rng.int(27, 34) + Math.floor(ga / 2))
  line._ga = (line._ga ?? 0) + ga
  line._sa = (line._sa ?? 0) + sa
  if (result === 'W') line.wins = (line.wins ?? 0) + 1
  else if (result === 'L') line.losses = (line.losses ?? 0) + 1
  else line.otl = (line.otl ?? 0) + 1
  if (ga === 0 && result === 'W') line.shutouts = (line.shutouts ?? 0) + 1
  const gp = line.gp
  line.gaa = gp > 0 ? Math.round(((line._ga * 60) / (gp * 60)) * 100) / 100 : 0
  line.svPct = line._sa > 0 ? Math.round(((line._sa - line._ga) / line._sa) * 1000) / 1000 : 0
}

function maybeInjure(s: GameState, team: TeamState, ctx: TeamGameCtx, rng: Rng): void {
  if (!rng.chance(0.03)) return
  const candidates = ctx.scorers.filter(isHealthy)
  if (candidates.length === 0) return
  const victim = rng.pick(candidates)
  victim.injuryWeeks = rng.int(1, 6)
  pushNews(s, `${victim.name} (${team.abbrev}) injured — out ${victim.injuryWeeks} week${victim.injuryWeeks > 1 ? 's' : ''}.`)
}

/** Simulate one game in place, writing result + player stats into `s`. */
export function simGame(s: GameState, game: Game, rng: Rng): void {
  const home = s.teams[game.home]
  const away = s.teams[game.away]
  const hc = buildCtx(home, rng)
  const ac = buildCtx(away, rng)
  const gH = hc.goalie ? hc.goalie.overall : 74
  const gA = ac.goalie ? ac.goalie.overall : 74

  const xgH = expectedGoals(hc.off, ac.def, gA, true)
  const xgA = expectedGoals(ac.off, hc.def, gH, false)
  let goalsH = rng.poisson(xgH)
  let goalsA = rng.poisson(xgA)

  let endType: 'REG' | 'OT' | 'SO' = 'REG'
  let homeWon: boolean
  if (goalsH === goalsA) {
    const strH = hc.off - ac.def
    const strA = ac.off - hc.def
    const homeBetter = strH >= strA
    const winProb = homeBetter ? 0.55 : 0.45
    homeWon = rng.chance(winProb)
    endType = rng.chance(0.6) ? 'OT' : 'SO'
    if (homeWon) goalsH++
    else goalsA++
  } else {
    homeWon = goalsH > goalsA
  }

  game.homeGoals = goalsH
  game.awayGoals = goalsA
  game.endType = endType
  game.played = true

  // GP for active players + starting goalie.
  for (const p of hc.scorers) ensureStat(s, p.id).gp++
  for (const p of ac.scorers) ensureStat(s, p.id).gp++
  if (hc.goalie) ensureStat(s, hc.goalie.id).gp++
  if (ac.goalie) ensureStat(s, ac.goalie.id).gp++

  // Attribution: in OT/SO, the winning goal was already added above; SO goals
  // still get attributed for simplicity but are rare edge cases.
  attributeGoals(s, hc, ac, goalsH, rng)
  attributeGoals(s, ac, hc, goalsA, rng)

  // Goalie decisions.
  const homeResult: 'W' | 'L' | 'OTL' = homeWon ? 'W' : endType === 'REG' ? 'L' : 'OTL'
  const awayResult: 'W' | 'L' | 'OTL' = !homeWon ? 'W' : endType === 'REG' ? 'L' : 'OTL'
  recordGoalie(s, hc.goalie, goalsA, homeResult, rng)
  recordGoalie(s, ac.goalie, goalsH, awayResult, rng)

  maybeInjure(s, home, hc, rng)
  maybeInjure(s, away, ac, rng)
}

/** Play every unplayed game scheduled for `day`. */
export function simDay(s: GameState, day: number, rng: Rng): void {
  for (const g of s.schedule) {
    if (g.day === day && !g.played) simGame(s, g, rng)
  }
}

/** Reduce injury counters by one week (called on week boundaries). */
export function healInjuries(s: GameState): void {
  for (const abbr of Object.keys(s.teams)) {
    for (const p of s.teams[abbr].roster) {
      if (p.injuryWeeks && p.injuryWeeks > 0) p.injuryWeeks = Math.max(0, p.injuryWeeks - 1)
    }
  }
}

/** Best-of-7 playoff series sim (no player stat attribution). Returns winner. */
export function simSeries(s: GameState, high: string, low: string, rng: Rng): { winner: string; highWins: number; lowWins: number } {
  const hc = buildCtx(s.teams[high], rng)
  const lc = buildCtx(s.teams[low], rng)
  const gH = hc.goalie ? hc.goalie.overall : 74
  const gL = lc.goalie ? lc.goalie.overall : 74
  let highWins = 0
  let lowWins = 0
  let gameNo = 0
  while (highWins < 4 && lowWins < 4) {
    // Home ice for higher seed in games 1,2,5,7 (0-indexed 0,1,4,6).
    const highHome = gameNo === 0 || gameNo === 1 || gameNo === 4 || gameNo === 6
    const xgHigh = expectedGoals(hc.off, lc.def, gL, highHome)
    const xgLow = expectedGoals(lc.off, hc.def, gH, !highHome)
    let a = rng.poisson(xgHigh)
    let b = rng.poisson(xgLow)
    if (a === b) {
      const highBetter = hc.off - lc.def >= lc.off - hc.def
      const highWinsGame = rng.chance(highBetter ? 0.55 : 0.45)
      if (highWinsGame) a++
      else b++
    }
    if (a > b) highWins++
    else lowWins++
    gameNo++
  }
  return { winner: highWins > lowWins ? high : low, highWins, lowWins }
}

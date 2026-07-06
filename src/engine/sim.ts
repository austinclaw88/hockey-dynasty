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
  /** Per-player scoring production factor (age + recent form), cached per game. */
  factors: Map<string, number>
}

function sortedByOverall(players: Player[]): Player[] {
  return [...players].sort((a, b) => b.overall - a.overall)
}

/** Age-based scoring production factor: peaks 21-31, declines with age; rookies
 *  (under 21) rarely lead the league. */
function ageFactor(age: number): number {
  if (age < 21) return 0.85
  if (age <= 31) return 1.0
  if (age <= 33) return 0.9
  if (age <= 35) return 0.78
  if (age <= 37) return 0.62
  return 0.5
}

/** Recent-form factor from the player's most recent archived season (which
 *  includes the real bundled history). ppg-driven, clamped; needs >= 20 GP. */
function formFactor(s: GameState, p: Player): number {
  const hist = s.careers[p.id]
  if (!hist || hist.length === 0) return 1.0
  const last = hist[hist.length - 1] // careers are stored oldest -> newest
  if (!last || last.gp < 20) return 1.0
  const ppg = last.points / last.gp
  return clamp(0.75 + ppg * 0.35, 0.8, 1.25)
}

/** Combined scoring weight multiplier for a skater (age x recent form). */
function productionFactor(s: GameState, p: Player): number {
  return ageFactor(p.age) * formFactor(s, p)
}

/** Roster-derived offense/defense ratings from the best healthy players. */
function buildCtx(s: GameState, team: TeamState, rng: Rng): TeamGameCtx {
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
  // Cache the production factor per scorer once per game (never per goal).
  const factors = new Map<string, number>()
  for (const p of scorers) factors.set(p.id, productionFactor(s, p))
  return { off, def: defRating, goalie, scorers, factors }
}

const LEAGUE_MEAN = 3.05

function expectedGoals(offA: number, defB: number, goalieB: number, home: boolean): number {
  let xg = LEAGUE_MEAN * Math.pow(1.1, (offA - defB) / 6) * Math.pow(1.08, (78 - goalieB) / 6)
  if (home) xg *= 1.04
  return clamp(xg, 1.4, 5.2)
}

// Goal attribution favors forwards heavily (defensemen score ~5-15% of goals).
// Assist attribution gives defensemen a much larger share (~30% of all helpers —
// D quarterback the play, first assist is often the D), so blueliners score
// their points primarily via assists, as in the real NHL. The D assist weight is
// quadratic like forwards' (scaled by ASSIST_DEF_MULT) so an elite offensive D
// separates from his pairing partner the way Makar-tier D do in reality.
const GOAL_DEF_MULT = 0.25 // D weight relative to forwards for goals
const ASSIST_DEF_MULT = Number((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DTUNE ?? 1.2) // D assist weight relative to forwards

// Forward scoring weight uses a soft "knee" above ~90 OVR: weight still rises
// with overall (a 99 clearly beats a 92), but with a reduced slope so that once
// the age/recent-form factors concentrate scoring onto in-form stars, a single
// developed 99-OVR superstar can't run away to an unrealistic 190-point season.
const FWD_KNEE = 35 // overall 90 (base = overall - 55)
const FWD_KNEE_SLOPE = 0.4
function forwardBase(overall: number): number {
  const raw = Math.max(1, overall - 55)
  return raw <= FWD_KNEE ? raw : FWD_KNEE + (raw - FWD_KNEE) * FWD_KNEE_SLOPE
}

/** Goal-scorer weight: base^2, forwards use the soft knee, D at GOAL_DEF_MULT. */
function goalWeight(p: Player): number {
  if (isForward(p)) {
    const b = forwardBase(p.overall)
    return b * b
  }
  const raw = Math.max(1, p.overall - 55)
  return raw * raw * GOAL_DEF_MULT
}

/** Assist weight: base^2. Forwards use the soft knee (above); defensemen are
 *  scaled by ASSIST_DEF_MULT and saturate hard at 85 OVR so late-dynasty 95+
 *  OVR blueliners don't outscore the league's forwards — and, once the age/
 *  recent-form factors concentrate scoring, don't run past the NHL realism band. */
function assistWeight(p: Player): number {
  if (isForward(p)) {
    const b = forwardBase(p.overall)
    return b * b
  }
  const base = Math.max(1, p.overall - 55)
  const b = Math.min(base, 30)
  return b * b * ASSIST_DEF_MULT
}

/** Weighted skater pick using a supplied per-player weight function. */
function pickWeighted(scorers: Player[], rng: Rng, exclude: Set<string>, weightOf: (p: Player) => number): Player | null {
  let total = 0
  const weights: number[] = []
  for (const p of scorers) {
    if (exclude.has(p.id)) {
      weights.push(0)
      continue
    }
    const w = weightOf(p)
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

/** Weighted period for a regulation goal (~31/34/35% across periods 1-3). */
function regulationPeriod(rng: Rng): 1 | 2 | 3 {
  const r = rng.next()
  if (r < 0.31) return 1
  if (r < 0.65) return 2
  return 3
}

/** Attribute `goals` for the scoring team: credit stat lines AND record each
 *  goal into the game's box score (same scorer/assists — attributed once).
 *  When `otWinner` is true the LAST attributed goal is the overtime winner and
 *  gets period 4; all other goals are regulation (periods 1-3). */
function attributeGoals(s: GameState, game: Game, teamAbbrev: string, ctx: TeamGameCtx, conceding: TeamGameCtx, goals: number, rng: Rng, otWinner: boolean): void {
  const factorOf = (p: Player): number => ctx.factors.get(p.id) ?? 1
  const goalW = (p: Player): number => goalWeight(p) * factorOf(p)
  const assistW = (p: Player): number => assistWeight(p) * factorOf(p)
  for (let g = 0; g < goals; g++) {
    const exclude = new Set<string>()
    const scorer = pickWeighted(ctx.scorers, rng, exclude, goalW)
    if (!scorer) continue
    exclude.add(scorer.id)
    const sl = ensureStat(s, scorer.id)
    sl.goals++
    sl.points++
    sl.plusMinus++
    // 0-2 assists — defensemen weighted up so they collect ~1/3 of all helpers.
    const assistIds: string[] = []
    // ~1.6 assists per goal (7% unassisted, 70% of the rest with two helpers)
    const nAssists = rng.next() < 0.07 ? 0 : rng.next() < 0.7 ? 2 : 1
    for (let a = 0; a < nAssists; a++) {
      const helper = pickWeighted(ctx.scorers, rng, exclude, assistW)
      if (!helper) break
      exclude.add(helper.id)
      const hl = ensureStat(s, helper.id)
      hl.assists++
      hl.points++
      hl.plusMinus++
      assistIds.push(helper.id)
    }
    const period: 1 | 2 | 3 | 4 = otWinner && g === goals - 1 ? 4 : regulationPeriod(rng)
    game.goals!.push({ team: teamAbbrev, scorerId: scorer.id, assistIds, period })
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
  const hc = buildCtx(s, home, rng)
  const ac = buildCtx(s, away, rng)
  const gH = hc.goalie ? hc.goalie.overall : 74
  const gA = ac.goalie ? ac.goalie.overall : 74

  const xgH = expectedGoals(hc.off, ac.def, gA, true)
  const xgA = expectedGoals(ac.off, hc.def, gH, false)
  let goalsH = rng.poisson(xgH)
  let goalsA = rng.poisson(xgA)

  // Goals actually SCORED by skaters (regulation + any OT winner). The shootout
  // decider counts in the final score but is NOT a scored goal event.
  let attribH = goalsH
  let attribA = goalsA
  let otWinner: 'H' | 'A' | null = null

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
    if (endType === 'OT') {
      // OT winner is a real scored goal (period 4); the SO decider is not.
      otWinner = homeWon ? 'H' : 'A'
      if (homeWon) attribH++
      else attribA++
    }
  } else {
    homeWon = goalsH > goalsA
    attribH = goalsH
    attribA = goalsA
  }

  game.homeGoals = goalsH
  game.awayGoals = goalsA
  game.endType = endType
  game.played = true
  game.goals = [] // box score for this game (regular season only)

  // GP for active players + starting goalie.
  for (const p of hc.scorers) ensureStat(s, p.id).gp++
  for (const p of ac.scorers) ensureStat(s, p.id).gp++
  if (hc.goalie) ensureStat(s, hc.goalie.id).gp++
  if (ac.goalie) ensureStat(s, ac.goalie.id).gp++

  // Attribution: regulation goals spread across periods 1-3; the OT winner (if
  // any) is the final attributed goal for its team and gets period 4.
  attributeGoals(s, game, game.home, hc, ac, attribH, rng, otWinner === 'H')
  attributeGoals(s, game, game.away, ac, hc, attribA, rng, otWinner === 'A')

  // Goalie decisions. GA counts scored goals only (shootout decider excluded),
  // so goalie GA stays consistent with the summed skater goals + box score.
  const homeResult: 'W' | 'L' | 'OTL' = homeWon ? 'W' : endType === 'REG' ? 'L' : 'OTL'
  const awayResult: 'W' | 'L' | 'OTL' = !homeWon ? 'W' : endType === 'REG' ? 'L' : 'OTL'
  recordGoalie(s, hc.goalie, attribA, homeResult, rng)
  recordGoalie(s, ac.goalie, attribH, awayResult, rng)

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
  const hc = buildCtx(s, s.teams[high], rng)
  const lc = buildCtx(s, s.teams[low], rng)
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

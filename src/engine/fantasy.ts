// Dynasty fantasy draft: every NHL roster player enters a snake draft and each
// of the 32 teams builds a brand-new roster from scratch. Prospects, picks and
// contracts stay attached to the players; only the NHL rosters are re-drafted.
import type { GameState, Player, TeamState } from '../types.ts'
import type { Rng } from './rng.ts'
import { currentCap, nextCap, teamCapUsed, rosterCounts, ext, pushNews, type DraftResult } from './helpers.ts'
import { buildSchedule } from './schedule.ts'
import { toFreeAgent } from './freeAgency.ts'

const LEAGUE_MIN = 0.775
// Roster composition: hard minimums that every team MUST reach, plus soft targets
// the AI steers toward. Goalies are hard-capped at 2 (the goalie supply is tight,
// so no team hoards a third — that would strand another team below its minimum).
const MIN = { f: 12, d: 6, g: 2 }
const TARGET = { f: 13, d: 7, g: 2 }

type Grp = 'f' | 'd' | 'g'
function grpOf(p: Player): Grp {
  return p.pos === 'G' ? 'g' : p.pos === 'D' ? 'd' : 'f'
}

/** Team on the clock for the current pick given the snake order (reverses each
 *  round). Returns '' when the draft is complete / no fantasy draft is active. */
export function onClockTeam(s: GameState): string {
  const fd = s.fantasyDraft
  if (!fd || fd.order.length === 0) return ''
  const n = fd.order.length
  const total = n * fd.rounds
  if (fd.pickIndex >= total) return ''
  const round = Math.floor(fd.pickIndex / n)
  const posInRound = fd.pickIndex % n
  const idx = round % 2 === 0 ? posInRound : n - 1 - posInRound
  return fd.order[idx]
}

export interface FantasyBoard {
  onClock: string
  pickIndex: number
  round: number
  totalPicks: number
  recent: { pick: number; team: string; playerName: string }[]
}

/** Read-only board for the UI. `recent` is the last ~12 picks, newest last. */
export function fantasyBoard(s: GameState): FantasyBoard {
  const fd = s.fantasyDraft
  if (!fd) return { onClock: '', pickIndex: 0, round: 0, totalPicks: 0, recent: [] }
  const n = fd.order.length
  const totalPicks = n * fd.rounds
  const results = ext(s)._fantasyResults ?? []
  return {
    onClock: draftComplete(s) ? '' : onClockTeam(s),
    pickIndex: fd.pickIndex,
    round: Math.min(fd.rounds, Math.floor(fd.pickIndex / n) + 1),
    totalPicks,
    recent: results.slice(-12),
  }
}

/** The draft ends when the pool is empty or every team has hit `rounds` picks. */
function draftComplete(s: GameState): boolean {
  const fd = s.fantasyDraft
  if (!fd) return true
  if (fd.pool.length === 0) return true
  if (fd.pickIndex >= fd.order.length * fd.rounds) return true
  return Object.keys(s.teams).every((a) => s.teams[a].roster.length >= fd.rounds)
}

function fantasyValue(p: Player): number {
  return p.overall * 0.75 + p.potential * 0.25
}

/** Choose the best pool player for `team` under position + cap constraints.
 *  Guarantees the roster can still reach the position minimums (2 G / 6 D / 12 F)
 *  both locally (this team) and globally (never strand another team's minimum). */
function chooseFantasyPlayer(s: GameState, team: TeamState, rng: Rng): Player | null {
  const fd = s.fantasyDraft!
  const cap = currentCap(s.seasonYear)
  const used = teamCapUsed(team)
  const c = rosterCounts(team)
  const count = { f: c.f, d: c.d, g: c.g }
  const picksLeft = fd.rounds - team.roster.length // includes this pick

  const need = {
    f: Math.max(0, MIN.f - count.f),
    d: Math.max(0, MIN.d - count.d),
    g: Math.max(0, MIN.g - count.g),
  }
  const mandatory = need.f + need.d + need.g
  const forced = picksLeft <= mandatory // every remaining pick must fill a minimum

  // Global position supply vs the minimums all teams still owe: a beyond-minimum
  // pick of a group is only legal if the pool would still cover every minimum.
  const poolByGrp = { f: 0, d: 0, g: 0 }
  for (const p of fd.pool) poolByGrp[grpOf(p)]++
  const owed = { f: 0, d: 0, g: 0 }
  for (const abbr of Object.keys(s.teams)) {
    const rc = rosterCounts(s.teams[abbr])
    owed.f += Math.max(0, MIN.f - rc.f)
    owed.d += Math.max(0, MIN.d - rc.d)
    owed.g += Math.max(0, MIN.g - rc.g)
  }

  const consider = (p: Player): number | null => {
    const g = grpOf(p)
    const fillsMin = count[g] < MIN[g]
    if (forced && !fillsMin) return null // when forced, only fill minimums
    if (g === 'g' && count.g >= TARGET.g) return null // never a 3rd goalie
    if (!fillsMin) {
      // Beyond-minimum pick: keep the global supply able to cover all minimums.
      if (poolByGrp[g] - 1 < owed[g]) return null
    }
    // Cap: reserve the league minimum for every mandatory slot NOT filled here.
    const fillsDeficit = need[g] > 0
    const reserve = (mandatory - (fillsDeficit ? 1 : 0)) * LEAGUE_MIN
    if (used + (p.contract?.capHit ?? 0) + reserve > cap + 0.001) return null
    let score = fantasyValue(p)
    if (fillsDeficit) score += 8
    else if (g === 'd' && count.d < TARGET.d) score += 2
    else if (g === 'f' && count.f < TARGET.f) score += 1
    score += rng.float(-1.5, 1.5)
    return score
  }

  let best: Player | null = null
  let bestScore = -Infinity
  for (const p of fd.pool) {
    const sc = consider(p)
    if (sc !== null && sc > bestScore) {
      bestScore = sc
      best = p
    }
  }
  if (best) return best

  // Fallback (cap-tight): cheapest affordable player, preferring a needed
  // position, so the team still trends toward a legal roster.
  const affordable = fd.pool.filter((p) => used + (p.contract?.capHit ?? 0) <= cap + 0.001)
  if (affordable.length === 0) return null
  const wantsPos = (p: Player): boolean => {
    const g = grpOf(p)
    if (g === 'g') return count.g < MIN.g
    return need[g] > 0 || count[g] < TARGET[g]
  }
  const pref = affordable.filter(wantsPos)
  const pickFrom = pref.length > 0 ? pref : affordable.filter((p) => grpOf(p) !== 'g' || count.g < TARGET.g)
  const finalPool = pickFrom.length > 0 ? pickFrom : affordable
  finalPool.sort((a, b) => (a.contract?.capHit ?? 0) - (b.contract?.capHit ?? 0))
  return finalPool[0]
}

function applyPick(s: GameState, abbr: string, player: Player): void {
  const fd = s.fantasyDraft!
  fd.pool = fd.pool.filter((p) => p.id !== player.id)
  s.teams[abbr].roster.push(player)
  const es = ext(s)
  if (!es._fantasyResults) es._fantasyResults = []
  const r: DraftResult = { pick: fd.pickIndex + 1, team: abbr, playerName: player.name }
  es._fantasyResults.push(r)
  fd.pickIndex += 1
}

/** One AI (or auto) pick for the team on the clock. Returns the drafted player,
 *  or null if no legal player could be found (caller skips the slot). */
function aiPick(s: GameState, abbr: string, rng: Rng): Player | null {
  const best = chooseFantasyPlayer(s, s.teams[abbr], rng)
  if (!best) return null
  applyPick(s, abbr, best)
  return best
}

/** Advance AI picks until the user is on the clock or the draft completes. */
function autoAdvance(s: GameState, rng: Rng): void {
  let guard = 0
  const max = s.fantasyDraft!.order.length * s.fantasyDraft!.rounds + 40
  while (!draftComplete(s) && guard++ < max) {
    const onClock = onClockTeam(s)
    if (onClock === s.userTeam) break
    if (!aiPick(s, onClock, rng)) s.fantasyDraft!.pickIndex += 1
  }
  if (draftComplete(s)) finishFantasyDraft(s, rng)
}

/** Whether a USER pick keeps a legal roster completion possible. Blocks only when
 *  it would strand the minimums: too few remaining picks/cap, or the remaining
 *  pool can no longer cover a needed position. */
function userPickLegal(s: GameState, team: TeamState, player: Player): { ok: boolean; reason?: string } {
  const fd = s.fantasyDraft!
  const cap = currentCap(s.seasonYear)
  const c = rosterCounts(team)
  const count = { f: c.f, d: c.d, g: c.g }
  count[grpOf(player)] += 1
  const picksLeftAfter = fd.rounds - (team.roster.length + 1)
  const need = {
    f: Math.max(0, MIN.f - count.f),
    d: Math.max(0, MIN.d - count.d),
    g: Math.max(0, MIN.g - count.g),
  }
  const mandatory = need.f + need.d + need.g
  if (mandatory > picksLeftAfter) return { ok: false, reason: 'Pick would leave too few slots to fill roster minimums.' }
  // Remaining pool must still cover each needed position.
  const poolAfter = { f: 0, d: 0, g: 0 }
  for (const p of fd.pool) if (p.id !== player.id) poolAfter[grpOf(p)]++
  if (poolAfter.g < need.g || poolAfter.d < need.d || poolAfter.f < need.f) {
    return { ok: false, reason: 'Not enough remaining players to fill roster minimums at that position.' }
  }
  // Cap: the mandatory slots must still fit at the league minimum.
  const usedAfter = teamCapUsed(team) + (player.contract?.capHit ?? 0)
  if (usedAfter + mandatory * LEAGUE_MIN > cap + 0.001) {
    return { ok: false, reason: 'Not enough cap space to complete a legal roster.' }
  }
  return { ok: true }
}

/** User makes their pick when on the clock, then AI drafts up to the user again. */
export function doFantasyPick(s: GameState, playerId: string, rng: Rng): { ok: boolean; reason?: string } {
  const fd = s.fantasyDraft
  if (!fd || s.phase !== 'fantasyDraft') return { ok: false, reason: 'No fantasy draft in progress.' }
  if (onClockTeam(s) !== s.userTeam) return { ok: false, reason: 'Not your pick.' }
  const player = fd.pool.find((p) => p.id === playerId)
  if (!player) return { ok: false, reason: 'Player is not in the draft pool.' }
  const legal = userPickLegal(s, s.teams[s.userTeam], player)
  if (!legal.ok) return legal
  applyPick(s, s.userTeam, player)
  autoAdvance(s, rng)
  return { ok: true }
}

/** Autodraft the user's CURRENT pick (best available under constraints), then AI
 *  continues to the next user pick. No-op unless the user is on the clock. */
export function doAutoFantasyPick(s: GameState, rng: Rng): void {
  const fd = s.fantasyDraft
  if (!fd || s.phase !== 'fantasyDraft') return
  if (onClockTeam(s) !== s.userTeam) return
  if (!aiPick(s, s.userTeam, rng)) fd.pickIndex += 1
  autoAdvance(s, rng)
}

/** Autodraft every remaining pick (user + AI) until the draft completes. */
export function doAutoCompleteFantasyDraft(s: GameState, rng: Rng): void {
  const fd = s.fantasyDraft
  if (!fd || s.phase !== 'fantasyDraft') return
  let guard = 0
  const max = fd.order.length * fd.rounds + 40
  while (!draftComplete(s) && guard++ < max) {
    const onClock = onClockTeam(s)
    if (!aiPick(s, onClock, rng)) fd.pickIndex += 1
  }
  finishFantasyDraft(s, rng)
}

/** Close the draft: any leftover pool players (rare — the pool empties first)
 *  become free agents, then the schedule is built and the season begins. */
function finishFantasyDraft(s: GameState, rng: Rng): void {
  const fd = s.fantasyDraft
  if (!fd) return
  const cap = nextCap(s.seasonYear)
  for (const p of fd.pool) s.freeAgents.push(toFreeAgent(p, cap))
  s.fantasyDraft = undefined
  ext(s)._fantasyResults = undefined
  s.phase = 'regular'
  s.mode = 'fantasy'
  s.day = 0
  s.schedule = buildSchedule(s.teams, rng)
  pushNews(s, `Fantasy draft complete — the ${s.seasonYear}-${String((s.seasonYear + 1) % 100).padStart(2, '0')} season begins.`)
}

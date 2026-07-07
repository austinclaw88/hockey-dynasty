// Offseason orchestration: awards -> development -> resign -> draft ->
// freeAgency -> rosterCheck -> next season.
import type { GameState, Player, TeamState } from '../types.ts'
import { SEASONS_TOTAL, ROSTER_MIN, ROSTER_MAX } from '../types.ts'
import type { Rng } from './rng.ts'
import { nextCap, committedCapUsed, rosterCounts, pushNews, ext, pruneTradeBlock } from './helpers.ts'
import { maybeGenerateUserOffers } from './trades.ts'
import { askingFor, signingOutcome, type Asking } from './contracts.ts'
import { runDevelopment } from './development.ts'
import { generateName, pickNationality } from './names.ts'
import { buildDraftOrder, generateDraftClass, autoAdvanceDraft, finishDraft } from './draft.ts'
import { prepareFreeAgency, aiFreeAgencyDay, toFreeAgent } from './freeAgency.ts'
import { buildSeasonSummary } from './awards.ts'
import { buildSchedule } from './schedule.ts'

// ---- entering the offseason (from playoffs) -------------------------------
export function enterOffseason(s: GameState, _rng: Rng): void {
  buildSeasonSummary(s)
  s.phase = 'offseason'
  s.offseasonStep = 'awards'
}

// ---- resign step ----------------------------------------------------------
function aiWantsToKeep(team: TeamState, p: Player): boolean {
  if (team.strategy === 'contend') return p.overall >= 74
  if (team.strategy === 'rebuild') return p.age <= 26 || p.overall >= 80
  return p.overall >= 76
}

export function prepareResign(s: GameState, rng: Rng): void {
  const cap = nextCap(s.seasonYear)
  for (const abbr of Object.keys(s.teams)) {
    const team = s.teams[abbr]
    // Prospects: decrement ELC; renew if expired (stay cheap RFA).
    for (const p of team.prospects) {
      if (p.contract) {
        p.contract.yearsLeft -= 1
        if (p.contract.yearsLeft <= 0) p.contract = { capHit: 0.95, yearsLeft: 2, expiry: 'RFA' }
      }
    }
    const expiring: Player[] = []
    for (const p of team.roster) {
      if (p.contract) {
        p.contract.yearsLeft -= 1
        if (p.contract.yearsLeft <= 0) expiring.push(p)
      }
    }
    if (abbr === s.userTeam) continue // user resolves these manually
    // AI re-signs in DESCENDING overall so stars are prioritised for scarce cap.
    expiring.sort((a, b) => b.overall - a.overall)
    // Cap already committed to players who are NOT expiring (their deals carry
    // over); expiring deals free up. committedCapUsed skips the yearsLeft<=0
    // expiring players still on the roster. Track re-signings as we make them.
    let committed = committedCapUsed(team)
    for (const p of expiring) {
      const ask = askingFor(p, cap)
      const canFit = committed + ask.capHit <= cap + 0.001
      let keep: boolean
      if (p.overall >= 85) {
        keep = canFit // franchise players are near-automatic; only walk if impossible
      } else if (p.overall >= 80) {
        keep = canFit && rng.chance(0.9) // high probability
      } else {
        keep = aiWantsToKeep(team, p) && canFit // depth churn unchanged
      }
      if (keep) {
        p.contract = { capHit: ask.capHit, yearsLeft: ask.years, expiry: p.age < 27 ? 'RFA' : 'UFA', ntc: p.contract?.ntc }
        committed += ask.capHit
      } else {
        team.roster = team.roster.filter((x) => x.id !== p.id)
        s.freeAgents.push(toFreeAgent(p, cap))
      }
    }
  }
  s.offseasonStep = 'resign'
}

export function userExpiring(s: GameState): Player[] {
  return s.teams[s.userTeam].roster.filter((p) => p.contract && p.contract.yearsLeft <= 0)
}

export function getResignAsking(s: GameState, playerId: string): Asking {
  const p = s.teams[s.userTeam].roster.find((x) => x.id === playerId)
  const cap = nextCap(s.seasonYear)
  if (!p) return { capHit: 0.775, years: 1 }
  return askingFor(p, cap)
}

export function doResignPlayer(s: GameState, playerId: string, years: number, capHit: number, rng: Rng): { ok: boolean; reason?: string } {
  const team = s.teams[s.userTeam]
  const p = team.roster.find((x) => x.id === playerId)
  if (!p || !p.contract || p.contract.yearsLeft > 0) return { ok: false, reason: 'Player is not an expiring free agent.' }
  const cap = nextCap(s.seasonYear)
  // Cap check against COMMITTED cap only: every expiring player (this one and any
  // others still awaiting a decision) carries a dead 0-year hit that must not be
  // counted — committedCapUsed skips them, so re-signing reflects real space.
  if (committedCapUsed(team) + capHit > cap + 0.001) return { ok: false, reason: 'Not enough cap space.' }
  const ask = askingFor(p, cap)
  const isRFA = p.age < 27 || p.contract.expiry === 'RFA'
  if (isRFA) {
    if (capHit < ask.capHit * 0.9) return { ok: false, reason: 'Offer too low — RFA will not sign.' }
  } else {
    const outcome = signingOutcome(ask, capHit, rng.next())
    if (!outcome.ok) return { ok: false, reason: outcome.reason }
  }
  p.contract = { capHit: Math.round(capHit * 1000) / 1000, yearsLeft: years, expiry: p.age < 27 ? 'RFA' : 'UFA', ntc: p.contract.ntc }
  pushNews(s, `${p.name} re-signs with ${s.userTeam} (${capHit.toFixed(2)}M x${years}).`)
  return { ok: true }
}

export function doLetWalk(s: GameState, playerId: string): void {
  const team = s.teams[s.userTeam]
  const p = team.roster.find((x) => x.id === playerId)
  if (!p || !p.contract || p.contract.yearsLeft > 0) return
  team.roster = team.roster.filter((x) => x.id !== playerId)
  s.freeAgents.push(toFreeAgent(p, nextCap(s.seasonYear)))
  pushNews(s, `${p.name} leaves ${s.userTeam} in free agency.`)
}

function finalizeResign(s: GameState): void {
  // Any unresolved user expiring players walk to free agency.
  const team = s.teams[s.userTeam]
  const cap = nextCap(s.seasonYear)
  const walking = team.roster.filter((p) => p.contract && p.contract.yearsLeft <= 0)
  for (const p of walking) s.freeAgents.push(toFreeAgent(p, cap))
  team.roster = team.roster.filter((p) => !(p.contract && p.contract.yearsLeft <= 0))
}

// ---- draft step -----------------------------------------------------------
export function prepareDraft(s: GameState, rng: Rng): void {
  const draftYear = s.seasonYear + 1
  // The FIRST in-game draft seeds from the real projected class (if provided for
  // this year); later drafts (and an empty file) are fully generated.
  const file = ext(s)._draft2027
  const real = file && file.year === draftYear && file.players.length > 0 ? file.players : undefined
  s.draftOrder = buildDraftOrder(s, rng)
  s.draftClass = generateDraftClass(rng, draftYear, real)
  ext(s)._draftResults = []
  s.day = 0
  s.offseasonStep = 'draft'
  autoAdvanceDraft(s, rng)
}

// ---- roster check ---------------------------------------------------------
let jmnCounter = 0
function makeJourneyman(s: GameState, pos: Player['pos'], rng: Rng): Player {
  const age = rng.int(24, 32)
  const nationality = pickNationality(rng)
  return {
    id: `JMN-${s.seasonYear}-${jmnCounter++}`,
    name: generateName(rng, nationality),
    pos,
    age,
    shoots: rng.chance(0.6) ? 'L' : 'R',
    overall: rng.int(70, 74),
    potential: rng.int(70, 74),
    nationality,
    injuryWeeks: 0,
    retired: false,
    contract: { capHit: 0.775, yearsLeft: 1, expiry: age < 27 ? 'RFA' : 'UFA' },
  }
}

function fixRoster(s: GameState, team: TeamState, rng: Rng, isUser: boolean): void {
  const cap = nextCap(s.seasonYear)
  let added = 0
  const shedOverCap = (): void => {
    // Bring under cap by waiving lowest-overall (respecting position minimums).
    let guard = 0
    while (committedCapUsed(team) > cap + 0.001 && team.roster.length > ROSTER_MIN && guard++ < 40) {
      const c = rosterCounts(team)
      const removable = [...team.roster]
        .sort((a, b) => a.overall - b.overall)
        .find((p) => (p.pos === 'G' ? c.g > 2 : p.pos === 'D' ? c.d > 6 : c.f > 12))
      if (!removable) break
      team.roster = team.roster.filter((p) => p.id !== removable.id)
    }
  }
  const fillMinimums = (): void => {
    const ensure = (pos: Player['pos'], min: number, current: () => number): void => {
      while (current() < min) {
        team.roster.push(makeJourneyman(s, pos, rng))
        added++
      }
    }
    ensure('G', 2, () => rosterCounts(team).g)
    ensure('D', 6, () => rosterCounts(team).d)
    ensure('C', 12, () => rosterCounts(team).f)
    while (team.roster.length < ROSTER_MIN) {
      team.roster.push(makeJourneyman(s, 'C', rng))
      added++
    }
  }
  // Mandatory fills can push a tight team over the cap; alternate shed/fill
  // until stable (a shed pricey vet gets replaced by a league-min journeyman).
  for (let round = 0; round < 3; round++) {
    shedOverCap()
    fillMinimums()
    if (committedCapUsed(team) <= cap + 0.001) break
  }
  // A team CANNOT end the offseason over the cap. If every position is already
  // at its minimum (nothing left to shed) yet the roster is still over, swap the
  // least valuable non-minimum-salary player for a league-minimum journeyman of
  // the same position until legal. Guaranteed to converge (each swap lowers cap).
  let capGuard = 0
  while (committedCapUsed(team) > cap + 0.001 && capGuard++ < 40) {
    const victim = [...team.roster].sort((a, b) => a.overall - b.overall).find((p) => (p.contract?.capHit ?? 0) > 0.9)
    if (!victim) break
    team.roster = team.roster.filter((p) => p.id !== victim.id)
    team.roster.push(makeJourneyman(s, victim.pos, rng))
    if (isUser) added++
  }
  // Trim to max size (drop lowest-overall extras that keep minimums).
  let guard = 0
  while (team.roster.length > ROSTER_MAX && guard++ < 40) {
    const c = rosterCounts(team)
    const removable = [...team.roster]
      .sort((a, b) => a.overall - b.overall)
      .find((p) => (p.pos === 'G' ? c.g > 2 : p.pos === 'D' ? c.d > 6 : c.f > 12))
    if (!removable) break
    team.roster = team.roster.filter((p) => p.id !== removable.id)
  }
  if (isUser && added > 0) {
    pushNews(s, `Your roster was short — ${added} league-minimum player${added > 1 ? 's' : ''} added to reach a legal lineup.`)
  }
}

export function rosterCheck(s: GameState, rng: Rng): void {
  for (const abbr of Object.keys(s.teams)) {
    fixRoster(s, s.teams[abbr], rng, abbr === s.userTeam)
  }
}

// ---- next season ----------------------------------------------------------
function inferStrategy(team: TeamState): 'contend' | 'retool' | 'rebuild' {
  const sorted = [...team.roster].sort((a, b) => b.overall - a.overall)
  let top10 = 0
  const n = Math.min(10, sorted.length)
  for (let i = 0; i < n; i++) top10 += sorted[i].overall
  top10 = n ? top10 / n : 78
  let meanAge = 0
  for (const p of team.roster) meanAge += p.age
  meanAge = team.roster.length ? meanAge / team.roster.length : 27
  if (top10 >= 84) return 'contend'
  if (top10 <= 78.5 || meanAge <= 25.5) return 'rebuild'
  return 'retool'
}

export function startNextSeason(s: GameState, rng: Rng): void {
  s.seasonIndex += 1
  s.seasonYear += 1
  // Clear per-season transient state.
  s.stats = {}
  s.playoffs = undefined
  s.freeAgents = []
  s.draftClass = []
  s.draftOrder = undefined
  ext(s)._draftResults = undefined
  s.offseasonStep = undefined
  s.pendingOffers = [] // offers do not carry across seasons
  pruneTradeBlock(s) // drop any blocked players who retired / left this offseason
  s.day = 0
  for (const abbr of Object.keys(s.teams)) {
    const team = s.teams[abbr]
    for (const p of team.roster) p.injuryWeeks = 0
    team.strategy = inferStrategy(team)
  }
  if (s.seasonIndex >= SEASONS_TOTAL) {
    s.phase = 'over'
    return
  }
  s.phase = 'regular'
  s.schedule = buildSchedule(s.teams, rng)
  pushNews(s, `The ${s.seasonYear}-${(s.seasonYear + 1) % 100} season begins.`)
}

// ---- the step machine -----------------------------------------------------
export function advanceOffseasonStep(s: GameState, rng: Rng): void {
  switch (s.offseasonStep) {
    case 'awards':
      runDevelopment(s, rng)
      s.offseasonStep = 'development'
      break
    case 'development':
      prepareResign(s, rng)
      break
    case 'resign':
      finalizeResign(s)
      prepareDraft(s, rng)
      break
    case 'draft':
      finishDraft(s, rng)
      prepareFreeAgency(s, rng)
      s.offseasonStep = 'freeAgency'
      break
    case 'freeAgency': {
      // Run out remaining FA days, then roster check + next season.
      while (s.day < 5) {
        aiFreeAgencyDay(s, rng)
        maybeGenerateUserOffers(s, rng, s.day, true)
        s.day++
      }
      rosterCheck(s, rng)
      startNextSeason(s, rng)
      break
    }
    default:
      break
  }
}

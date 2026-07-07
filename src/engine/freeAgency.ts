// Free agency: building the FA pool, AI signings per day, user signings, and the
// restricted-free-agent offer-sheet flow (match + draft-pick compensation).
import type { GameState, Player, FreeAgent, Position, TeamState, DraftPick, PendingOfferSheet } from '../types.ts'
import { ROSTER_MAX } from '../types.ts'
import type { Rng } from './rng.ts'
import { askingFor, signingOutcome, effectiveAsk, seasonAskDecay } from './contracts.ts'
import { generateName, pickNationality } from './names.ts'
import { currentCap, nextCap, committedCapUsed, teamCapUsed, capForPhase, capUsedForPhase, rosterCounts, isForward, pushNews, ext } from './helpers.ts'

export function toFreeAgent(p: Player, cap: number): FreeAgent {
  const fa: FreeAgent = { ...p, contract: null, injuryWeeks: 0, asking: askingFor(p, cap) }
  return fa
}

/** Generate journeyman/veteran filler free agents so AI can fill rosters. */
function generateVeteranFA(rng: Rng, cap: number, year: number, i: number): FreeAgent {
  const roll = rng.next()
  const pos: Position = roll < 0.6 ? (rng.chance(0.5) ? 'C' : rng.chance(0.5) ? 'LW' : 'RW') : roll < 0.85 ? 'D' : 'G'
  const overall = rng.int(68, 72) // depth-tier filler only; real players dominate the pool
  const age = rng.int(27, 35)
  const nationality = pickNationality(rng)
  const p: Player = {
    id: `FA-${year}-${i}`,
    name: generateName(rng, nationality),
    pos,
    age,
    shoots: rng.chance(0.6) ? 'L' : 'R',
    overall,
    potential: overall,
    contract: null,
    nationality,
    injuryWeeks: 0,
    retired: false,
  }
  return toFreeAgent(p, cap)
}

/** Prepare the FA pool at the start of the freeAgency step. */
export function prepareFreeAgency(s: GameState, rng: Rng): void {
  const cap = nextCap(s.seasonYear)
  // Ensure walked players already have asking (they were added during resign).
  s.freeAgents = s.freeAgents.map((fa) => (fa.asking ? fa : toFreeAgent(fa, cap)))
  // Real players (35 seeded UFAs + anyone who walked) should DOMINATE the pool.
  // Only top up with a handful of depth-tier fillers when the pool is genuinely
  // thin (< 25), and never more than ~8 league-wide (all <= 72 OVR).
  const POOL_MIN = 25
  const MAX_FILLERS = 8
  const fillers = s.freeAgents.length < POOL_MIN ? Math.min(MAX_FILLERS, POOL_MIN - s.freeAgents.length) : 0
  const start = s.freeAgents.length
  for (let i = 0; i < fillers; i++) {
    s.freeAgents.push(generateVeteranFA(rng, cap, s.seasonYear, start + i))
  }
  // Sort by overall so "best available" is meaningful for the UI.
  s.freeAgents.sort((a, b) => b.overall - a.overall)
  s.pendingSheets = []
  s.day = 0
}

function positionNeed(team: TeamState): Position | null {
  const c = rosterCounts(team)
  if (c.g < 2) return 'G'
  if (c.d < 6) return 'D'
  if (c.f < 12) return 'C'
  return null
}

/** Move a pool free agent onto a team at explicit (capHit, years) terms, clearing
 *  him from the FA pool. Used by AI signings, offer-sheet resolutions, and the
 *  end-of-FA auto re-sign of unclaimed RFAs. */
function signToTeam(s: GameState, team: TeamState, fa: FreeAgent, years: number, capHit: number, ntc = false): void {
  const expiry: 'RFA' | 'UFA' = fa.age < 27 ? 'RFA' : 'UFA'
  const player: Player = {
    id: fa.id,
    name: fa.name,
    pos: fa.pos,
    age: fa.age,
    shoots: fa.shoots,
    overall: fa.overall,
    potential: fa.potential,
    nationality: fa.nationality,
    injuryWeeks: 0,
    retired: false,
    contract: { capHit: Math.round(capHit * 1000) / 1000, yearsLeft: years, expiry, ntc: ntc || undefined },
  }
  team.roster.push(player)
  s.freeAgents = s.freeAgents.filter((x) => x.id !== fa.id)
}

/** One FA day of AI signings. Stars sign only on days 0-1. RFAs whose rights are
 *  held (rightsTeam set) are NOT signable outright — they change teams only via an
 *  offer sheet, handled separately (maybeAiOfferSheets). */
export function aiFreeAgencyDay(s: GameState, rng: Rng): void {
  pruneSheets(s)
  const cap = nextCap(s.seasonYear)
  const teams = rng.shuffle(Object.keys(s.teams).filter((a) => a !== s.userTeam))
  for (const abbr of teams) {
    const team = s.teams[abbr]
    let signings = 0
    const maxSignings = rng.int(1, 2)
    while (signings < maxSignings) {
      const space = cap - committedCapUsed(team)
      const counts = rosterCounts(team)
      if (counts.total >= ROSTER_MAX) break
      const need = positionNeed(team)
      // Pick best affordable FA matching need (or best overall if roster full-ish).
      let target: FreeAgent | undefined
      for (const fa of s.freeAgents) {
        if (fa.rightsTeam) continue // restricted — requires an offer sheet
        if (fa.asking.capHit > space + 0.001) continue
        if (fa.overall >= 85 && s.day > 1) continue // stars sign early
        if (need) {
          const grp: Position = fa.pos === 'G' ? 'G' : fa.pos === 'D' ? 'D' : 'C'
          const needGrp: Position = need
          const matches = needGrp === 'G' ? grp === 'G' : needGrp === 'D' ? grp === 'D' : grp !== 'G' && grp !== 'D'
          if (!matches) continue
        } else if (counts.total >= 21) {
          // Roster is fine; only sign clear upgrades occasionally.
          if (!rng.chance(0.15)) break
        }
        target = fa
        break
      }
      if (!target) break
      signToTeam(s, team, target, target.asking.years, target.asking.capHit)
      if (target.overall >= 80) pushNews(s, `${target.name} signs with ${abbr} (${target.asking.capHit.toFixed(2)}M x${target.asking.years}).`)
      signings++
    }
  }
  maybeAiOfferSheets(s, rng)
}

/** User signs a free agent. Works in the offseason freeAgency step AND during the
 *  regular season (leftover UFAs stay signable — task 3). Cap + roster are checked
 *  on the same basis the engine enforces for the phase (offseason → NEXT cap on a
 *  committed basis; regular → CURRENT cap). RFAs whose rights are held require an
 *  offer sheet, and nobody signs during the playoffs. Offering an NTC and extra
 *  term lower the effective ask; in-season asks also decay over time. */
export function doSignFreeAgent(s: GameState, playerId: string, years: number, capHit: number, rng: Rng, ntc = false): { ok: boolean; reason?: string } {
  const fa = s.freeAgents.find((x) => x.id === playerId)
  if (!fa) return { ok: false, reason: 'Player is not a free agent.' }
  if (fa.rightsTeam) return { ok: false, reason: 'Restricted free agent — requires an offer sheet.' }
  if (s.phase === 'playoffs') return { ok: false, reason: 'Free agents cannot be signed during the playoffs.' }
  const cap = capForPhase(s)
  const team = s.teams[s.userTeam]
  if (rosterCounts(team).total >= ROSTER_MAX) return { ok: false, reason: 'Roster is full (23).' }
  if (capUsedForPhase(s, team) + capHit > cap + 0.001) return { ok: false, reason: 'Not enough cap space.' }
  const eff = Math.max(0.775, Math.round(effectiveAsk(fa.asking, fa, years, ntc) * seasonAskDecay(s) * 1000) / 1000)
  const outcome = signingOutcome({ capHit: eff, years }, capHit, rng.next())
  if (!outcome.ok) return { ok: false, reason: outcome.reason }
  signToTeam(s, team, fa, years, capHit, ntc)
  pushNews(s, `${fa.name} signs with ${s.userTeam} (${capHit.toFixed(2)}M x${years}${ntc ? ', NTC' : ''}).`)
  return { ok: true }
}

// ---- offer sheets (restricted free agents) --------------------------------
// A qualified RFA sits in the FA pool with `rightsTeam` set. Another club can
// TENDER an offer sheet at/above his ask; the rights team then MATCHES (keeping
// the player at the offered terms) or declines, in which case the player leaves
// and the rights team receives draft-pick compensation tiered by the AAV.

/** Compensation rounds owed for an offer sheet of the given AAV ($M). */
function compensationRounds(aav: number): number[] {
  if (aav < 1.5) return []
  if (aav < 3) return [3]
  if (aav < 4.5) return [2]
  if (aav < 7) return [1]
  if (aav < 9) return [1, 3]
  return [1, 2, 3]
}

function describePicks(picks: DraftPick[]): string {
  if (picks.length === 0) return 'no picks'
  const ord = (r: number): string => (r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`)
  return picks.map((pk) => `${pk.year} ${ord(pk.round)}`).join(' + ')
}

/** Earliest-year owned pick of each required round (distinct). Returns null when
 *  the payer is missing any required round — a STRICT check for tenders. */
function selectCompPicks(s: GameState, payer: string, rounds: number[]): DraftPick[] | null {
  const owned = s.teams[payer]?.picks ?? []
  const used = new Set<DraftPick>()
  const out: DraftPick[] = []
  for (const round of rounds) {
    const pick = owned
      .filter((pk) => pk.round === round && !used.has(pk))
      .sort((a, b) => a.year - b.year)[0]
    if (!pick) return null
    used.add(pick)
    out.push(pick)
  }
  return out
}

/** Like selectCompPicks but never fails: a missing round falls back to the
 *  payer's best remaining pick (lowest round, earliest year). Used when an AI
 *  team owes the USER compensation and may lack the exact round. */
function selectCompPicksLoose(s: GameState, payer: string, rounds: number[]): DraftPick[] {
  const owned = s.teams[payer]?.picks ?? []
  const used = new Set<DraftPick>()
  const out: DraftPick[] = []
  for (const round of rounds) {
    let pick = owned.filter((pk) => pk.round === round && !used.has(pk)).sort((a, b) => a.year - b.year)[0]
    if (!pick) pick = owned.filter((pk) => !used.has(pk)).sort((a, b) => a.round - b.round || a.year - b.year)[0]
    if (!pick) break
    used.add(pick)
    out.push(pick)
  }
  return out
}

/** Move specific pick objects to `toTeam`, updating ownership. */
function movePicksTo(s: GameState, toTeam: string, picks: DraftPick[]): void {
  for (const pk of picks) {
    const owner = s.teams[pk.owner]
    if (!owner) continue
    const i = owner.picks.indexOf(pk)
    if (i < 0) continue
    const [found] = owner.picks.splice(i, 1)
    found.owner = toTeam
    s.teams[toTeam].picks.push(found)
  }
}

/** Probability the rights team matches an offer sheet: base 80% when the deal
 *  fits under next season's cap, minus 8% per 5% of overpay above the ask, floored
 *  at 25%. A deal they cannot fit is never matched (0). */
function matchProbability(s: GameState, rightsTeam: string, capHit: number, eff: number): number {
  const rt = s.teams[rightsTeam]
  if (!rt) return 0
  const cap = nextCap(s.seasonYear)
  if (committedCapUsed(rt) + capHit > cap + 0.001) return 0
  const overpay = Math.max(0, (capHit - eff) / eff)
  const p = 0.8 - 0.08 * (overpay / 0.05)
  return Math.max(0.25, p)
}

/** Resolve an offer sheet: the rights team either matches (re-signs at the offered
 *  terms) or the buyer signs the player and pays `comp` to the rights team. Shared
 *  by the user tender, AI-to-AI sheets, and AI-to-user declines. Returns whether it
 *  was matched. Assumes `comp` was already validated/selected for the buyer. */
function resolveSheet(s: GameState, fa: FreeAgent, buyer: string, years: number, capHit: number, comp: DraftPick[], rng: Rng): boolean {
  const rightsAbbr = fa.rightsTeam!
  const eff = effectiveAsk(fa.asking, fa, years, false)
  const matched = rng.chance(matchProbability(s, rightsAbbr, capHit, eff))
  if (matched) {
    signToTeam(s, s.teams[rightsAbbr], fa, years, capHit)
    pushNews(s, `${fa.name} — ${rightsAbbr} matches the offer sheet (${capHit.toFixed(2)}M x${years}).`)
    return true
  }
  signToTeam(s, s.teams[buyer], fa, years, capHit)
  movePicksTo(s, rightsAbbr, comp)
  pushNews(s, `${fa.name} signs with ${buyer} on an offer sheet — ${rightsAbbr} receives ${describePicks(comp)}.`)
  return false
}

/** User tenders an offer sheet to another team's RFA. The offer must be at least
 *  the player's effective ask; the user must have cap/roster room (they may end up
 *  signing him) AND the draft picks the compensation tier requires. */
export function doTenderOfferSheet(s: GameState, playerId: string, years: number, capHit: number, rng: Rng): { ok: boolean; matched?: boolean; reason?: string } {
  const fa = s.freeAgents.find((x) => x.id === playerId)
  if (!fa || !fa.rightsTeam) return { ok: false, reason: 'Player is not an offer-sheet-eligible restricted free agent.' }
  if (fa.rightsTeam === s.userTeam) return { ok: false, reason: 'You already hold this player’s rights.' }
  if (s.phase !== 'offseason') return { ok: false, reason: 'Offer sheets can only be tendered in the offseason.' }
  const cap = nextCap(s.seasonYear)
  const user = s.teams[s.userTeam]
  const capHitR = Math.round(capHit * 1000) / 1000
  const eff = effectiveAsk(fa.asking, fa, years, false)
  if (capHitR < eff - 0.001) return { ok: false, reason: `Offer must be at least ${eff.toFixed(2)}M (the player’s ask).` }
  if (rosterCounts(user).total >= ROSTER_MAX) return { ok: false, reason: 'Roster is full (23).' }
  if (committedCapUsed(user) + capHitR > cap + 0.001) return { ok: false, reason: 'Not enough cap space for the offer.' }
  const rounds = compensationRounds(capHitR)
  const comp = selectCompPicks(s, s.userTeam, rounds)
  if (comp === null) return { ok: false, reason: `You lack the draft picks required as compensation (${rounds.map((r) => (r === 1 ? '1st' : r === 2 ? '2nd' : '3rd')).join(' + ')}).` }
  const matched = resolveSheet(s, fa, s.userTeam, years, capHitR, comp, rng)
  return { ok: true, matched }
}

/** User responds to an AI-tendered offer sheet on one of their RFAs. Match →
 *  re-sign at the sheet's terms (must fit cap/roster). Decline → the player leaves
 *  for the AI team and the user receives pick compensation. */
export function doRespondToOfferSheet(s: GameState, sheetId: number, match: boolean, _rng: Rng): { ok: boolean; reason?: string } {
  const sheets = s.pendingSheets ?? []
  const sheet = sheets.find((x) => x.id === sheetId)
  if (!sheet) return { ok: false, reason: 'Offer sheet not found.' }
  const fa = s.freeAgents.find((x) => x.id === sheet.playerId && x.rightsTeam === s.userTeam)
  if (!fa) {
    s.pendingSheets = sheets.filter((x) => x.id !== sheetId)
    return { ok: false, reason: 'This player is no longer available.' }
  }
  if (match) {
    const cap = nextCap(s.seasonYear)
    const user = s.teams[s.userTeam]
    if (rosterCounts(user).total >= ROSTER_MAX) return { ok: false, reason: 'Roster is full (23).' }
    if (committedCapUsed(user) + sheet.capHit > cap + 0.001) return { ok: false, reason: 'Not enough cap space to match.' }
    signToTeam(s, user, fa, sheet.years, sheet.capHit)
    pushNews(s, `${fa.name} — you match ${sheet.from}’s offer sheet (${sheet.capHit.toFixed(2)}M x${sheet.years}).`)
    s.pendingSheets = sheets.filter((x) => x.id !== sheetId)
    return { ok: true }
  }
  declineSheet(s, sheet)
  s.pendingSheets = (s.pendingSheets ?? []).filter((x) => x.id !== sheetId)
  return { ok: true }
}

/** Execute a decline: the player signs with the tendering AI team and the USER
 *  receives compensation from that team's picks (loose — best available if short). */
function declineSheet(s: GameState, sheet: PendingOfferSheet): void {
  const fa = s.freeAgents.find((x) => x.id === sheet.playerId && x.rightsTeam === s.userTeam)
  if (!fa) return
  const from = s.teams[sheet.from]
  if (!from) return
  const comp = selectCompPicksLoose(s, sheet.from, compensationRounds(sheet.capHit))
  signToTeam(s, from, fa, sheet.years, sheet.capHit)
  movePicksTo(s, s.userTeam, comp)
  pushNews(s, `${fa.name} signs with ${sheet.from} on an offer sheet — you receive ${describePicks(comp)}.`)
}

/** Drop pending sheets whose player is no longer an unsigned user RFA. */
export function pruneSheets(s: GameState): void {
  if (!s.pendingSheets || s.pendingSheets.length === 0) return
  s.pendingSheets = s.pendingSheets.filter((sh) => s.freeAgents.some((fa) => fa.id === sh.playerId && fa.rightsTeam === s.userTeam))
}

function nextSheetId(s: GameState): number {
  const es = ext(s)
  es._nextSheetId = (es._nextSheetId ?? 0) + 1
  return es._nextSheetId
}

/** Once per FA day, an AI team may go after another club's RFA with an offer
 *  sheet (rare — roughly 1-2 league-wide per offseason). Targets on the USER's
 *  RFAs arrive as PendingOfferSheets; targets on other AI teams resolve at once. */
export function maybeAiOfferSheets(s: GameState, rng: Rng): void {
  if (!rng.chance(0.35)) return
  const rfas = s.freeAgents.filter((fa) => fa.rightsTeam)
  if (rfas.length === 0) return
  const fa = rng.pick(rfas)
  const rightsAbbr = fa.rightsTeam!
  const cap = nextCap(s.seasonYear)
  const years = fa.asking.years
  const capHit = Math.round(fa.asking.capHit * rng.float(1.1, 1.3) * 1000) / 1000
  const rounds = compensationRounds(capHit)
  // Candidate buyers: any other club with cap room, roster room, and the picks
  // the compensation tier demands. For a USER RFA the buyer is any AI team.
  const buyers = rng.shuffle(Object.keys(s.teams).filter((a) => a !== rightsAbbr && a !== s.userTeam))
  for (const buyerAbbr of buyers) {
    const buyer = s.teams[buyerAbbr]
    if (rosterCounts(buyer).total >= ROSTER_MAX) continue
    if (committedCapUsed(buyer) + capHit > cap + 0.001) continue
    if (selectCompPicks(s, buyerAbbr, rounds) === null) continue
    if (rightsAbbr === s.userTeam) {
      const sheet: PendingOfferSheet = { id: nextSheetId(s), playerId: fa.id, from: buyerAbbr, years, capHit, day: s.day }
      s.pendingSheets = s.pendingSheets ?? []
      s.pendingSheets.push(sheet)
      pushNews(s, `${buyerAbbr} tenders an offer sheet to your RFA ${fa.name} (${capHit.toFixed(2)}M x${years}) — match or take the compensation.`)
    } else {
      const comp = selectCompPicks(s, buyerAbbr, rounds)!
      resolveSheet(s, fa, buyerAbbr, years, capHit, comp, rng)
    }
    return
  }
}

/** End of the FA step: unanswered user sheets auto-decline (player leaves, user
 *  gets compensation), then every remaining qualified RFA auto-re-signs with his
 *  rights team at his ask — they never walk for free. A rights team that cannot
 *  fit the deal releases him as a true UFA (rosterCheck / next season handles). */
export function finalizeOfferSheets(s: GameState): void {
  for (const sheet of [...(s.pendingSheets ?? [])]) declineSheet(s, sheet)
  s.pendingSheets = []
  const cap = nextCap(s.seasonYear)
  for (const fa of [...s.freeAgents]) {
    if (!fa.rightsTeam) continue
    const rt = s.teams[fa.rightsTeam]
    if (!rt) {
      fa.rightsTeam = undefined
      continue
    }
    if (committedCapUsed(rt) + fa.asking.capHit <= cap + 0.001 && rosterCounts(rt).total < ROSTER_MAX) {
      signToTeam(s, rt, fa, fa.asking.years, fa.asking.capHit)
    } else {
      fa.rightsTeam = undefined // becomes a true UFA
    }
  }
}

/** Task 3: a small weekly chance that an AI team with an injury hole and cap room
 *  signs the best leftover UFA that fits, so the in-season pool realistically
 *  thins. One signing league-wide per call. */
export function maybeAiInSeasonSigning(s: GameState, rng: Rng): void {
  if (s.phase !== 'regular') return
  if (s.freeAgents.length === 0) return
  if (!rng.chance(0.25)) return
  const cap = currentCap(s.seasonYear)
  const decay = seasonAskDecay(s)
  const teams = rng.shuffle(Object.keys(s.teams).filter((a) => a !== s.userTeam))
  for (const abbr of teams) {
    const team = s.teams[abbr]
    const injured = team.roster.filter((p) => p.injuryWeeks && p.injuryWeeks > 0).length
    if (injured < 2) continue
    if (rosterCounts(team).total >= ROSTER_MAX) continue
    const space = cap - teamCapUsed(team)
    const target = s.freeAgents
      .filter((fa) => !fa.rightsTeam && fa.asking.capHit * decay <= space + 0.001)
      .sort((a, b) => b.overall - a.overall)[0]
    if (!target) continue
    const capHit = Math.max(0.775, Math.round(target.asking.capHit * decay * 1000) / 1000)
    signToTeam(s, team, target, target.asking.years, capHit)
    pushNews(s, `${target.name} signs with ${abbr} (${capHit.toFixed(2)}M x${target.asking.years}).`)
    return
  }
}

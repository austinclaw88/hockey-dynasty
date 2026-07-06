// Trade value model, evaluation, execution, and AI trade generation.
import type { GameState, Player, DraftPick, TeamState } from '../types'
import { ROSTER_MAX, ROSTER_MIN } from '../types'
import type { Rng } from './rng'
import { currentCap, teamCapUsed, rosterCounts, pushNews } from './helpers'
import { askingFor } from './contracts'
import { computeStandings, sortRows } from './standings'

export interface TradeOffer {
  from: string
  to: string
  fromPlayers: string[]
  toPlayers: string[]
  fromPicks: DraftPick[]
  toPicks: DraftPick[]
}

/** Player trade value on an abstract scale (an 80 OVR ≈ 3). */
export function playerValue(p: Player, cap: number): number {
  let v = Math.exp((p.overall - 80) / 7) * 3
  if (p.age <= 23 && p.potential > p.overall) {
    v *= 1 + Math.min(1.5, (p.potential - p.overall) / 15)
  }
  if (p.age >= 30) v *= Math.max(0.4, 1 - (p.age - 29) * 0.09)
  // Contract: underpaid adds, overpaid subtracts (vs fair asking).
  const fair = askingFor(p, cap).capHit
  const capHit = p.contract?.capHit ?? fair
  v += (fair - capHit) * 0.5
  return Math.max(0.1, v)
}

/** Rank of a team in the standings (1 = best). */
function teamRank(s: GameState, abbrev: string): number {
  const rows = sortRows(Object.values(computeStandings(s)))
  const idx = rows.findIndex((r) => r.team === abbrev)
  return idx < 0 ? 16 : idx + 1
}

export function pickValue(s: GameState, pick: DraftPick): number {
  const rank = teamRank(s, pick.originalTeam) // worse team -> earlier pick -> more value
  const r1 = Math.max(2, 8 - (32 - rank) * 0.18)
  return pick.round === 1 ? r1 : r1 * 0.33
}

function sumPlayers(s: GameState, team: string, ids: string[], cap: number): { val: number; players: Player[] } {
  const t = s.teams[team]
  const players: Player[] = []
  let val = 0
  for (const id of ids) {
    const p = t.roster.find((x) => x.id === id) ?? t.prospects.find((x) => x.id === id)
    if (p) {
      players.push(p)
      val += playerValue(p, cap)
    }
  }
  return { val, players }
}

function sumPicks(s: GameState, picks: DraftPick[]): number {
  let v = 0
  for (const pk of picks) v += pickValue(s, pk)
  return v
}

/** Strategy fit multiplier for value the partner RECEIVES. */
function strategyFit(strategy: TeamState['strategy'], players: Player[], picksVal: number): number {
  let mult = 1
  for (const p of players) {
    if (strategy === 'rebuild') {
      if (p.age <= 24) mult += 0.04
      else if (p.age >= 30) mult -= 0.05
    } else if (strategy === 'contend') {
      if (p.age >= 32) mult -= 0.02
      if (p.overall >= 85) mult += 0.04
    }
  }
  if (strategy === 'rebuild') mult += Math.min(0.2, picksVal * 0.02)
  if (strategy === 'contend') mult -= Math.min(0.1, picksVal * 0.01)
  return Math.max(0.7, Math.min(1.4, mult))
}

export function evaluateTrade(s: GameState, offer: TradeOffer): { accept: boolean; verdict: string; delta: number } {
  const cap = currentCap(s.seasonYear)
  const partner = s.teams[offer.to]
  if (!partner) return { accept: false, verdict: 'not close', delta: 0 }

  const received = sumPlayers(s, offer.from, offer.fromPlayers, cap)
  const givenBack = sumPlayers(s, offer.to, offer.toPlayers, cap)
  const recPicks = sumPicks(s, offer.fromPicks)
  const givePicks = sumPicks(s, offer.toPicks)

  // Partner won't move a no-trade player.
  if (givenBack.players.some((p) => p.contract?.ntc)) {
    return { accept: false, verdict: 'not close', delta: -1 }
  }

  const partnerReceives = (received.val + recPicks) * strategyFit(partner.strategy, received.players, recPicks)
  const partnerGives = givenBack.val + givePicks
  const delta = partnerReceives - partnerGives

  // Cap + roster legality for the partner after the swap.
  const partnerRosterCount = partner.roster.length - givenBack.players.filter((p) => partner.roster.includes(p)).length + received.players.filter((p) => s.teams[offer.from].roster.includes(p)).length
  const partnerCapAfter = teamCapUsed(partner) - givenBack.players.reduce((a, p) => a + (p.contract?.capHit ?? 0), 0) + received.players.reduce((a, p) => a + (p.contract?.capHit ?? 0), 0)
  const capOk = partnerCapAfter <= cap + 0.001
  const rosterOk = partnerRosterCount >= ROSTER_MIN - 3 && partnerRosterCount <= ROSTER_MAX

  const threshold = partnerGives * 0.05
  const accept = delta >= threshold && capOk && rosterOk

  let verdict: string
  if (accept) verdict = 'accepted'
  else if (!capOk || !rosterOk) verdict = 'not close'
  else if (delta >= -partnerGives * 0.15) verdict = 'close — sweeten it'
  else if (delta >= -partnerGives * 0.5) verdict = 'not close'
  else verdict = 'insulting'

  return { accept, verdict, delta: Math.round(delta * 100) / 100 }
}

function movePlayers(s: GameState, fromTeam: string, toTeam: string, ids: string[]): void {
  const from = s.teams[fromTeam]
  const to = s.teams[toTeam]
  for (const id of ids) {
    let idx = from.roster.findIndex((p) => p.id === id)
    if (idx >= 0) {
      const [p] = from.roster.splice(idx, 1)
      to.roster.push(p)
      continue
    }
    idx = from.prospects.findIndex((p) => p.id === id)
    if (idx >= 0) {
      const [p] = from.prospects.splice(idx, 1)
      to.prospects.push(p)
    }
  }
}

function movePicks(s: GameState, toTeam: string, picks: DraftPick[]): void {
  const to = s.teams[toTeam]
  for (const pk of picks) {
    // Find the pick object among all teams (by identity of year/round/original).
    for (const abbr of Object.keys(s.teams)) {
      const arr = s.teams[abbr].picks
      const i = arr.findIndex((x) => x.year === pk.year && x.round === pk.round && x.originalTeam === pk.originalTeam)
      if (i >= 0) {
        const [found] = arr.splice(i, 1)
        found.owner = toTeam
        to.picks.push(found)
        break
      }
    }
  }
}

/** Trades allowed: regular season up to day 120, or offseason freeAgency step. */
export function tradesAllowed(s: GameState): boolean {
  if (s.phase === 'regular') return s.day <= 120
  if (s.phase === 'offseason') return s.offseasonStep === 'freeAgency'
  return false
}

export function executeTrade(s: GameState, offer: TradeOffer): { ok: boolean; reason?: string } {
  if (!tradesAllowed(s)) return { ok: false, reason: 'Trades are closed (past the deadline).' }
  const evalResult = evaluateTrade(s, offer)
  if (!evalResult.accept) return { ok: false, reason: `Rejected: ${evalResult.verdict}.` }

  // Execute the swap.
  const fromNames = offer.fromPlayers.map((id) => nameOf(s, offer.from, id)).filter(Boolean)
  const toNames = offer.toPlayers.map((id) => nameOf(s, offer.to, id)).filter(Boolean)
  movePlayers(s, offer.from, offer.to, offer.fromPlayers)
  movePlayers(s, offer.to, offer.from, offer.toPlayers)
  movePicks(s, offer.to, offer.fromPicks)
  movePicks(s, offer.from, offer.toPicks)

  const fromDesc = [...fromNames, ...offer.fromPicks.map((p) => `${p.year} R${p.round}`)].join(', ') || 'nothing'
  const toDesc = [...toNames, ...offer.toPicks.map((p) => `${p.year} R${p.round}`)].join(', ') || 'nothing'
  pushNews(s, `TRADE: ${offer.from} send ${fromDesc} to ${offer.to} for ${toDesc}.`)
  return { ok: true }
}

function nameOf(s: GameState, team: string, id: string): string {
  const t = s.teams[team]
  const p = t.roster.find((x) => x.id === id) ?? t.prospects.find((x) => x.id === id)
  return p ? p.name : ''
}

/** Build a fair offer around a player the partner would move by strategy. */
export function getAiTradeSuggestion(s: GameState, partner: string): TradeOffer | null {
  const cap = currentCap(s.seasonYear)
  const pt = s.teams[partner]
  const user = s.teams[s.userTeam]
  if (!pt || !user) return null

  // A player the partner would move: rebuilders shop veterans, contenders shop
  // youth/depth. Avoid NTC players.
  const movable = pt.roster.filter((p) => !p.contract?.ntc).sort((a, b) => {
    if (pt.strategy === 'rebuild') return b.age - a.age
    return a.overall - b.overall
  })
  const target = movable.find((p) => p.overall >= 74)
  if (!target) return null
  const targetVal = playerValue(target, cap)

  // Assemble user assets to roughly match (from user's most expendable pieces).
  const userAssets = [...user.roster].filter((p) => !p.contract?.ntc && p.overall < target.overall + 2).sort((a, b) => a.overall - b.overall)
  const chosen: Player[] = []
  let val = 0
  for (const p of userAssets) {
    if (val >= targetVal * 1.05) break
    chosen.push(p)
    val += playerValue(p, cap)
  }
  const fromPicks: DraftPick[] = []
  if (val < targetVal * 1.05) {
    // Add a pick to sweeten.
    const pick = user.picks.find((pk) => pk.round === 1) ?? user.picks[0]
    if (pick) fromPicks.push(pick)
  }
  if (chosen.length === 0 && fromPicks.length === 0) return null

  return {
    from: s.userTeam,
    to: partner,
    fromPlayers: chosen.map((p) => p.id),
    toPlayers: [target.id],
    fromPicks,
    toPicks: [],
  }
}

/** Occasional AI-to-AI trade during the season (~1 per two weeks). */
export function maybeAiAiTrade(s: GameState, rng: Rng): void {
  if (s.day > 120) return
  if (!rng.chance(1 / 14)) return
  const abbrevs = Object.keys(s.teams).filter((a) => a !== s.userTeam)
  const rebuilders = abbrevs.filter((a) => s.teams[a].strategy === 'rebuild')
  const contenders = abbrevs.filter((a) => s.teams[a].strategy === 'contend')
  if (rebuilders.length === 0 || contenders.length === 0) return
  const seller = s.teams[rng.pick(rebuilders)]
  const buyer = s.teams[rng.pick(contenders)]
  const cap = currentCap(s.seasonYear)

  const target = [...seller.roster].filter((p) => !p.contract?.ntc && p.age >= 28 && p.overall >= 78).sort((a, b) => b.overall - a.overall)[0]
  if (!target || !target.contract) return
  if (teamCapUsed(buyer) + target.contract.capHit > cap + 0.001) return
  const pick = buyer.picks.find((pk) => pk.round === 1) ?? buyer.picks[0]
  if (!pick) return

  // Move target -> buyer, pick -> seller.
  const idx = seller.roster.findIndex((p) => p.id === target.id)
  if (idx < 0) return
  const [moved] = seller.roster.splice(idx, 1)
  buyer.roster.push(moved)
  const pi = buyer.picks.findIndex((pk) => pk === pick)
  if (pi >= 0) {
    const [pk] = buyer.picks.splice(pi, 1)
    pk.owner = seller.abbrev
    seller.picks.push(pk)
  }
  pushNews(s, `TRADE: ${buyer.abbrev} acquire ${moved.name} from ${seller.abbrev} for a ${pick.year} R${pick.round} pick.`)
}

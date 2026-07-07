// Trade value model, evaluation, execution, and AI trade generation.
import type { GameState, Player, DraftPick, TeamState, TradeOffer } from '../types.ts'
import { ROSTER_MAX, ROSTER_MIN } from '../types.ts'
import type { Rng } from './rng.ts'
import { capForPhase, capUsedForPhase, rosterCounts, pushNews, pruneTradeBlock, ext } from './helpers.ts'
import { askingFor } from './contracts.ts'
import { computeStandings, sortRows } from './standings.ts'

export type { TradeOffer } from '../types.ts'

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
  const cap = capForPhase(s)
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

  // Cap + roster legality for the partner after the swap. Prospects carry ELCs
  // but do NOT count against the 23-man roster or the cap — only NHL-roster
  // players moving in/out change the partner's roster size and cap hit.
  const givenBackRoster = givenBack.players.filter((p) => partner.roster.includes(p))
  const receivedRoster = received.players.filter((p) => s.teams[offer.from].roster.includes(p))
  const partnerRosterCount = partner.roster.length - givenBackRoster.length + receivedRoster.length
  const partnerCapAfter = capUsedForPhase(s, partner) - givenBackRoster.reduce((a, p) => a + (p.contract?.capHit ?? 0), 0) + receivedRoster.reduce((a, p) => a + (p.contract?.capHit ?? 0), 0)
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

/** Perform the asset swap + news, with no acceptance/legality gating. Callers
 *  must have already validated. Keeps trade block + pending offers coherent. */
function commitTrade(s: GameState, offer: TradeOffer): void {
  const fromNames = offer.fromPlayers.map((id) => nameOf(s, offer.from, id)).filter(Boolean)
  const toNames = offer.toPlayers.map((id) => nameOf(s, offer.to, id)).filter(Boolean)
  movePlayers(s, offer.from, offer.to, offer.fromPlayers)
  movePlayers(s, offer.to, offer.from, offer.toPlayers)
  movePicks(s, offer.to, offer.fromPicks)
  movePicks(s, offer.from, offer.toPicks)

  const fromDesc = [...fromNames, ...offer.fromPicks.map((p) => `${p.year} R${p.round}`)].join(', ') || 'nothing'
  const toDesc = [...toNames, ...offer.toPicks.map((p) => `${p.year} R${p.round}`)].join(', ') || 'nothing'
  pushNews(s, `TRADE: ${offer.from} send ${fromDesc} to ${offer.to} for ${toDesc}.`)
  // Roster composition changed — keep block/offers referencing only live assets.
  pruneTradeBlock(s)
  pruneOffers(s)
}

export function executeTrade(s: GameState, offer: TradeOffer): { ok: boolean; reason?: string } {
  if (!tradesAllowed(s)) return { ok: false, reason: 'Trades are closed (past the deadline).' }
  const evalResult = evaluateTrade(s, offer)
  if (!evalResult.accept) return { ok: false, reason: `Rejected: ${evalResult.verdict}.` }
  commitTrade(s, offer)
  return { ok: true }
}

function nameOf(s: GameState, team: string, id: string): string {
  const t = s.teams[team]
  const p = t.roster.find((x) => x.id === id) ?? t.prospects.find((x) => x.id === id)
  return p ? p.name : ''
}

/** Build a fair offer around a player the partner would move by strategy. */
export function getAiTradeSuggestion(s: GameState, partner: string): TradeOffer | null {
  const cap = capForPhase(s)
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
  return buildUserPaysPackage(s, partner, target, cap)
}

// ===========================================================================
// Shared package builders (used by suggestions AND incoming AI offers)
// ===========================================================================

/** Sum of capHits for the given ids that currently sit on a team's NHL roster
 *  (prospects carry contracts but do not count against the cap). */
function rosterCapOf(team: TeamState, ids: string[]): number {
  let v = 0
  for (const id of ids) {
    const p = team.roster.find((x) => x.id === id)
    if (p) v += p.contract?.capHit ?? 0
  }
  return v
}

/** Cap + roster-size legality for BOTH teams after a swap. `from` is the user. */
function tradeLegalBothWays(s: GameState, offer: TradeOffer, cap: number): boolean {
  const user = s.teams[offer.from]
  const partner = s.teams[offer.to]
  if (!user || !partner) return false
  // Only NHL-roster players change roster size / cap; prospects & picks do not.
  const userGivesRoster = offer.fromPlayers.filter((id) => user.roster.some((p) => p.id === id))
  const userGetsRoster = offer.toPlayers.filter((id) => partner.roster.some((p) => p.id === id))
  const userRosterAfter = user.roster.length - userGivesRoster.length + userGetsRoster.length
  const partnerRosterAfter = partner.roster.length - userGetsRoster.length + userGivesRoster.length
  if (userRosterAfter < ROSTER_MIN || userRosterAfter > ROSTER_MAX) return false
  if (partnerRosterAfter < ROSTER_MIN || partnerRosterAfter > ROSTER_MAX) return false
  const userCapAfter = capUsedForPhase(s, user) - rosterCapOf(user, userGivesRoster) + rosterCapOf(partner, userGetsRoster)
  const partnerCapAfter = capUsedForPhase(s, partner) - rosterCapOf(partner, userGetsRoster) + rosterCapOf(user, userGivesRoster)
  if (userCapAfter > cap + 0.001) return false
  if (partnerCapAfter > cap + 0.001) return false
  return true
}

/** Build the package the USER must PAY to pry `target` off `partner` — the
 *  minimal overpay the partner would accept. Returns null if none fits. */
function buildUserPaysPackage(s: GameState, partner: string, target: Player, cap: number): TradeOffer | null {
  const user = s.teams[s.userTeam]
  if (!user || target.contract?.ntc) return null
  const targetVal = playerValue(target, cap)

  const userAssets = [...user.roster]
    .filter((p) => !p.contract?.ntc && p.overall < target.overall + 2)
    .sort((a, b) => a.overall - b.overall)
  const chosen: Player[] = []
  let val = 0
  for (const p of userAssets) {
    if (val >= targetVal * 1.05) break
    chosen.push(p)
    val += playerValue(p, cap)
  }
  const fromPicks: DraftPick[] = []
  const sparePicks = [...user.picks].sort((a, b) => pickValue(s, a) - pickValue(s, b)).reverse()
  let pickIdx = 0
  const offer: TradeOffer = {
    from: s.userTeam,
    to: partner,
    fromPlayers: chosen.map((p) => p.id),
    toPlayers: [target.id],
    fromPicks,
    toPicks: [],
  }
  // Sweeten with picks, then extra depth players, until the AI accepts.
  let guard = 0
  while (!evaluateTrade(s, offer).accept && guard++ < 12) {
    if (pickIdx < sparePicks.length && offer.fromPicks.length < 3) {
      offer.fromPicks.push(sparePicks[pickIdx++])
      continue
    }
    const extra = userAssets.find((p) => !offer.fromPlayers.includes(p.id))
    if (extra) {
      offer.fromPlayers.push(extra.id)
      continue
    }
    return null // exhausted reasonable assets
  }
  if (!evaluateTrade(s, offer).accept) return null
  if (offer.fromPlayers.length === 0 && offer.fromPicks.length === 0) return null
  return offer
}

/** Build the package a `partner` would GIVE to acquire the user's `target` —
 *  fair to the user (value ~1.0-1.15 in their favour) and legal both ways.
 *  Because the AI is initiating, it is willing to slightly overpay for a player
 *  it wants, so this is NOT gated on evaluateTrade's acceptance threshold. */
function buildPartnerPaysPackage(s: GameState, partner: string, target: Player, cap: number): TradeOffer | null {
  const user = s.teams[s.userTeam]
  const pt = s.teams[partner]
  if (!user || !pt || target.contract?.ntc) return null
  const targetVal = playerValue(target, cap)

  // Sweeteners never change roster size: picks + partner prospects.
  const sweeteners: { pick?: DraftPick; prospectId?: string; v: number }[] = [
    ...pt.picks.map((pk) => ({ pick: pk, v: pickValue(s, pk) })),
    ...pt.prospects.filter((p) => !p.contract?.ntc && p.overall >= 60).map((p) => ({ prospectId: p.id, v: playerValue(p, cap) })),
  ].sort((a, b) => a.v - b.v)

  const build = (anchorId: string | null, anchorVal: number): TradeOffer | null => {
    const toPlayers = anchorId ? [anchorId] : []
    const toPicks: DraftPick[] = []
    let val = anchorVal
    for (const sw of sweeteners) {
      if (val >= targetVal) break
      if (sw.pick) {
        toPicks.push(sw.pick)
        val += sw.v
      } else if (sw.prospectId) {
        toPlayers.push(sw.prospectId)
        val += sw.v
      }
    }
    const ratio = val / targetVal
    if (ratio < 0.98 || ratio > 1.25) return null
    const offer: TradeOffer = { from: s.userTeam, to: partner, fromPlayers: [target.id], toPlayers, fromPicks: [], toPicks }
    return tradeLegalBothWays(s, offer, cap) ? offer : null
  }

  // Mode A: net-neutral swap anchored by a comparable partner roster player.
  const anchors = pt.roster
    .filter((p) => !p.contract?.ntc && p.overall < target.overall + 3)
    .sort((a, b) => playerValue(b, cap) - playerValue(a, cap))
  for (const anchor of anchors) {
    const anchorVal = playerValue(anchor, cap)
    if (anchorVal > targetVal * 1.2) continue
    const offer = build(anchor.id, anchorVal)
    if (offer) return offer
  }
  // Mode B: picks/prospects only — user sheds a roster spot for futures.
  if (user.roster.length - 1 >= ROSTER_MIN && pt.roster.length + 1 <= ROSTER_MAX) {
    const offer = build(null, 0)
    if (offer) return offer
  }
  return null
}

/**
 * Player-seeded suggestion. If `playerId` is on the partner → what the user must
 * pay to get him; if on the user → what the partner would give for him. Null if
 * the giving side has an NTC, the player is untradeable, or no fair package fits.
 */
export function getAiTradeSuggestionFor(s: GameState, partner: string, playerId: string): TradeOffer | null {
  const cap = capForPhase(s)
  const pt = s.teams[partner]
  const user = s.teams[s.userTeam]
  if (!pt || !user) return null

  const onPartner = pt.roster.find((p) => p.id === playerId) ?? pt.prospects.find((p) => p.id === playerId)
  if (onPartner) {
    if (onPartner.contract?.ntc) return null
    return buildUserPaysPackage(s, partner, onPartner, cap)
  }
  const onUser = user.roster.find((p) => p.id === playerId)
  if (onUser) {
    if (onUser.contract?.ntc) return null
    return buildPartnerPaysPackage(s, partner, onUser, cap)
  }
  return null
}

/** Value the partner GIVES the user in an offer (return players + picks). */
function offerReturnValue(s: GameState, offer: TradeOffer, cap: number): number {
  return sumPlayers(s, offer.to, offer.toPlayers, cap).val + sumPicks(s, offer.toPicks)
}

/**
 * All fair trade packages other teams would give up for a USER-team player.
 * Evaluates every interested partner, builds each one's best fair package,
 * ranks by value offered to the user, and returns the top 3 (distinct
 * partners). Empty when nobody bites at fair value or the player is untradeable.
 */
export function getTradeOptionsFor(s: GameState, playerId: string): TradeOffer[] {
  const cap = capForPhase(s)
  const user = s.teams[s.userTeam]
  if (!user) return []
  // Roster players AND prospects can be shopped.
  const target = user.roster.find((p) => p.id === playerId) ?? user.prospects.find((p) => p.id === playerId)
  if (!target || target.contract?.ntc) return []
  const options: { offer: TradeOffer; value: number }[] = []
  for (const abbr of Object.keys(s.teams)) {
    if (abbr === s.userTeam) continue
    if (!wantsPlayer(s.teams[abbr], target)) continue
    const offer = buildPartnerPaysPackage(s, abbr, target, cap)
    if (!offer) continue
    options.push({ offer, value: offerReturnValue(s, offer, cap) })
  }
  options.sort((a, b) => b.value - a.value)
  return options.slice(0, 3).map((o) => o.offer)
}

/**
 * Fired the moment a player is toggled ONTO the trade block: immediately shop
 * him to the league and, if any partner bites, push 1-2 firm offers plus a news
 * item so the user sees interest without waiting for the weekly tick.
 */
export function generateBlockOffers(s: GameState, rng: Rng, playerId: string): void {
  if (!tradesAllowed(s)) return
  const user = s.teams[s.userTeam]
  const target = user?.roster.find((p) => p.id === playerId) ?? user?.prospects.find((p) => p.id === playerId)
  if (!target) return
  const options = getTradeOptionsFor(s, playerId)
  if (options.length === 0) return
  // Best 1-2 distinct partners jump on it right away.
  const take = Math.min(rng.int(1, 2), options.length)
  let pushed = 0
  for (let i = 0; i < take; i++) {
    const offer = options[i]
    if (s.pendingOffers.some((o) => o.offer.to === offer.to && o.offer.fromPlayers.includes(playerId))) continue
    const id = nextOfferId(s)
    s.pendingOffers.push({ id, offer, day: s.day, seasonYear: s.seasonYear })
    if (s.pendingOffers.length > 3) s.pendingOffers.shift()
    pushed++
  }
  if (pushed > 0) pushNews(s, `Teams are calling about ${target.name}.`)
}

// ===========================================================================
// Incoming AI trade offers (PendingOffer lifecycle)
// ===========================================================================

/** Are all players referenced by an offer still on the expected rosters? */
function offerAssetsPresent(s: GameState, offer: TradeOffer): boolean {
  const user = s.teams[offer.from]
  const partner = s.teams[offer.to]
  if (!user || !partner) return false
  const onTeam = (t: TeamState, id: string): boolean => t.roster.some((p) => p.id === id) || t.prospects.some((p) => p.id === id)
  return offer.fromPlayers.every((id) => onTeam(user, id)) && offer.toPlayers.every((id) => onTeam(partner, id))
}

/** Drop expired / stale pending offers: wrong season, past the deadline, older
 *  than ~14 days, outside a trade window, or referencing departed players. */
export function pruneOffers(s: GameState): void {
  if (!s.pendingOffers || s.pendingOffers.length === 0) return
  s.pendingOffers = s.pendingOffers.filter((o) => {
    if (o.seasonYear !== s.seasonYear) return false
    if (s.phase === 'regular') {
      if (s.day > 120) return false
      if (s.day - o.day > 14) return false
    } else if (s.phase !== 'offseason') {
      return false // playoffs / over: no live offers
    }
    return offerAssetsPresent(s, o.offer)
  })
}

function nextOfferId(s: GameState): number {
  const e = ext(s)
  const id = e._nextOfferId ?? 1
  e._nextOfferId = id + 1
  return id
}

/** Would team `t` plausibly want to acquire `target`? */
function wantsPlayer(t: TeamState, target: Player): boolean {
  if (t.strategy === 'contend') return target.overall >= 76
  if (t.strategy === 'retool') return target.overall >= 80
  // rebuild: only young building blocks or genuine stars
  return (target.age <= 24 && target.potential >= 80) || target.overall >= 84
}

/**
 * Possibly generate ONE incoming AI offer for a user player this tick. Called
 * ~once per sim-day in the regular season (before the deadline) and once per FA
 * day in the offseason. Shopped (trade-block) players draw real interest;
 * unblocked stars only occasionally. Offers are firm — the AI commits to them.
 */
export function maybeGenerateUserOffers(s: GameState, rng: Rng, day: number, offseason: boolean): void {
  if (offseason) {
    if (s.phase !== 'offseason' || s.offseasonStep !== 'freeAgency') return
  } else {
    if (s.phase !== 'regular' || day > 120) return
  }
  const user = s.teams[s.userTeam]
  if (!user) return

  // Shopped players may be NHL-roster players OR prospects; stars are roster-only.
  const blockTargets = [...user.roster, ...user.prospects].filter((p) => s.tradeBlock.includes(p.id) && !p.contract?.ntc)
  const starTargets = user.roster.filter((p) => p.overall >= 85 && !p.contract?.ntc && !s.tradeBlock.includes(p.id))

  let target: Player | undefined
  // Blocked players draw strong, frequent interest so a shopped top-6 reliably
  // pulls a firm offer within ~2 sim weeks; unblocked stars only rarely.
  if (blockTargets.length > 0 && rng.chance(0.4)) target = rng.pick(blockTargets)
  else if (starTargets.length > 0 && rng.chance(0.03)) target = rng.pick(starTargets)
  if (!target) return

  const cap = capForPhase(s)
  const partners = rng.shuffle(Object.keys(s.teams).filter((a) => a !== s.userTeam && wantsPlayer(s.teams[a], target!)))
  for (const abbr of partners) {
    // Don't stack duplicate live offers for the same player from the same team.
    if (s.pendingOffers.some((o) => o.offer.to === abbr && o.offer.fromPlayers.includes(target!.id))) continue
    const offer = buildPartnerPaysPackage(s, abbr, target, cap)
    if (!offer) continue
    const id = nextOfferId(s)
    s.pendingOffers.push({ id, offer, day, seasonYear: s.seasonYear })
    if (s.pendingOffers.length > 3) s.pendingOffers.shift() // drop oldest
    const partnerTeam = s.teams[abbr]
    const payDesc =
      [...offer.toPlayers.map((pid) => nameOf(s, abbr, pid)).filter(Boolean), ...offer.toPicks.map((p) => `${p.year} R${p.round}`)].join(', ') || 'futures'
    pushNews(s, `${partnerTeam.abbrev} offer: ${target.name} for ${payDesc}.`)
    return // one offer per tick
  }
}

/** Respond to a pending AI offer. Accept re-validates + executes; decline drops. */
export function respondToOffer(s: GameState, offerId: number, accept: boolean): { ok: boolean; reason?: string } {
  const idx = s.pendingOffers.findIndex((o) => o.id === offerId)
  if (idx < 0) return { ok: false, reason: 'Offer not found or expired.' }
  const po = s.pendingOffers[idx]
  s.pendingOffers.splice(idx, 1)
  if (!accept) return { ok: true }
  // Re-validate against the live state before committing.
  if (!tradesAllowed(s)) return { ok: false, reason: 'Trades are closed (past the deadline).' }
  if (!offerAssetsPresent(s, po.offer)) return { ok: false, reason: 'A player in this offer is no longer available.' }
  const cap = capForPhase(s)
  if (!tradeLegalBothWays(s, po.offer, cap)) return { ok: false, reason: 'This trade would no longer be cap/roster legal.' }
  commitTrade(s, po.offer)
  return { ok: true }
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
  const cap = capForPhase(s)

  const target = [...seller.roster].filter((p) => !p.contract?.ntc && p.age >= 28 && p.overall >= 78).sort((a, b) => b.overall - a.overall)[0]
  if (!target || !target.contract) return
  if (capUsedForPhase(s, buyer) + target.contract.capHit > cap + 0.001) return
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

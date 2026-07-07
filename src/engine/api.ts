// Public engine API (browser + Node safe — no data-file import lives here).
// Every mutating function clones the input GameState and returns a NEW one so
// callers never observe in-place mutation. RNG state is threaded via rngState.
import type { GameState, StandingsRow, SeasonStatLine, Division, Player, LineAssignments } from '../types.ts'
import { Rng } from './rng.ts'
import { currentCap, nextCap, teamCapUsed, committedCapUsed, pruneTradeBlock } from './helpers.ts'
import { effectiveLines } from './sim.ts'
import { standingsView } from './standings.ts'
import { advanceRegularDays, advanceToEndOfSeason } from './season.ts'
import { advancePlayoffRound } from './playoffs.ts'
import { enterOffseason, advanceOffseasonStep, doResignPlayer, doLetWalk, getResignAsking as getResignAskingCore } from './offseason.ts'
import { doDraftPlayer, draftBoard, doAutoDraftPick, doAutoCompleteDraft, type DraftBoard } from './draft.ts'
import { doSignFreeAgent, aiFreeAgencyDay } from './freeAgency.ts'
import { getSigningPreview as getSigningPreviewCore, type SigningVerdict } from './contracts.ts'
import { doCallUp, doSendDown } from './roster.ts'
import {
  evaluateTrade as evaluateTradeCore,
  executeTrade as executeTradeCore,
  getAiTradeSuggestion as getAiTradeSuggestionCore,
  getAiTradeSuggestionFor as getAiTradeSuggestionForCore,
  getTradeOptionsFor as getTradeOptionsForCore,
  generateBlockOffers,
  respondToOffer as respondToOfferCore,
  maybeGenerateUserOffers,
  type TradeOffer,
} from './trades.ts'
import { saveGame, loadGame, hasSave, deleteSave } from './persistence.ts'

export type { TradeOffer } from './trades.ts'
export type { DraftBoard } from './draft.ts'
export type { SigningVerdict } from './contracts.ts'
export { saveGame, loadGame, hasSave, deleteSave }

function clone<T>(x: T): T {
  return typeof structuredClone === 'function' ? structuredClone(x) : (JSON.parse(JSON.stringify(x)) as T)
}

/** Clone, run a mutation with an RNG, thread the RNG state back, return new state. */
function withRng(s0: GameState, fn: (s: GameState, rng: Rng) => void): GameState {
  const s = clone(s0)
  const rng = new Rng(s.rngState)
  fn(s, rng)
  s.rngState = rng.state
  return s
}
function withResult(s0: GameState, fn: (s: GameState, rng: Rng) => { ok: boolean; reason?: string }): { s: GameState; ok: boolean; reason?: string } {
  const s = clone(s0)
  const rng = new Rng(s.rngState)
  const r = fn(s, rng)
  s.rngState = rng.state
  return { s, ok: r.ok, reason: r.reason }
}

// ---- simulation -----------------------------------------------------------
export function simDays(s: GameState, days: number): GameState {
  return withRng(s, (st, rng) => advanceRegularDays(st, days, rng))
}
export function simToEndOfSeason(s: GameState): GameState {
  return withRng(s, (st, rng) => advanceToEndOfSeason(st, rng))
}
export function simPlayoffRound(s: GameState): GameState {
  return withRng(s, (st, rng) => {
    if (st.phase !== 'playoffs') return
    const cupDecided = advancePlayoffRound(st, rng)
    if (cupDecided) enterOffseason(st, rng)
  })
}

// ---- offseason ------------------------------------------------------------
export function advanceOffseason(s: GameState): GameState {
  return withRng(s, (st, rng) => {
    if (st.phase === 'offseason') advanceOffseasonStep(st, rng)
  })
}
export function resignPlayer(s: GameState, playerId: string, years: number, capHit: number, ntc = false): { s: GameState; ok: boolean; reason?: string } {
  return withResult(s, (st, rng) => doResignPlayer(st, playerId, years, capHit, rng, ntc))
}
export function letWalk(s: GameState, playerId: string): GameState {
  return withRng(s, (st) => doLetWalk(st, playerId))
}
export function getResignAsking(s: GameState, playerId: string): { capHit: number; years: number } {
  return getResignAskingCore(s, playerId)
}
export function draftPlayer(s: GameState, playerId: string): GameState {
  return withRng(s, (st, rng) => doDraftPlayer(st, playerId, rng))
}
export function getDraftBoard(s: GameState): DraftBoard {
  return draftBoard(s)
}
/** Autodraft the user's current pick (best available by potential-weighted board
 *  value), then AI continues. No-op unless the user is on the clock in the draft step. */
export function autoDraftPick(s: GameState): GameState {
  return withRng(s, (st, rng) => {
    if (st.phase === 'offseason' && st.offseasonStep === 'draft') doAutoDraftPick(st, rng)
  })
}
/** Autodraft ALL remaining user picks and let AI finish the round order until the
 *  draft is complete. No-op unless in the draft step. */
export function autoCompleteDraft(s: GameState): GameState {
  return withRng(s, (st, rng) => {
    if (st.phase === 'offseason' && st.offseasonStep === 'draft') doAutoCompleteDraft(st, rng)
  })
}
export function signFreeAgent(s: GameState, playerId: string, years: number, capHit: number, ntc = false): { s: GameState; ok: boolean; reason?: string } {
  return withResult(s, (st, rng) => doSignFreeAgent(st, playerId, years, capHit, rng, ntc))
}
/** Live signing preview for the UI negotiation meter (effective ask + verdict).
 *  Works for pool free agents and the user's own expiring players. Pure. */
export function getSigningPreview(s: GameState, playerId: string, years: number, capHit: number, ntc: boolean): { effectiveAsk: number; verdict: SigningVerdict } {
  return getSigningPreviewCore(s, playerId, years, capHit, ntc)
}
export function advanceFreeAgencyDay(s: GameState): GameState {
  return withRng(s, (st, rng) => {
    if (st.phase === 'offseason' && st.offseasonStep === 'freeAgency' && st.day < 5) {
      aiFreeAgencyDay(st, rng)
      maybeGenerateUserOffers(st, rng, st.day, true)
      st.day += 1
    }
  })
}

// ---- roster moves ---------------------------------------------------------
export function callUp(s: GameState, playerId: string): { s: GameState; ok: boolean; reason?: string } {
  return withResult(s, (st) => doCallUp(st, playerId))
}
export function sendDown(s: GameState, playerId: string): { s: GameState; ok: boolean; reason?: string } {
  return withResult(s, (st) => doSendDown(st, playerId))
}

// ---- lines ----------------------------------------------------------------
/** Resolved, all-slots-filled lineup for a team (user lines honoured, others
 *  auto). The UI displays this; the sim drives attribution from it. */
export { effectiveLines }
/** Set the user team's manual line assignments (null clears to full-auto). Ids
 *  are validated against the user roster; invalid/foreign ids are silently
 *  dropped to '' (the sim auto-fills those slots). Returns a NEW GameState. */
export function setUserLines(s0: GameState, lines: LineAssignments | null): GameState {
  const s = clone(s0)
  if (lines === null) {
    s.userLines = undefined
    return s
  }
  const team = s.teams[s.userTeam]
  const ids = new Set(team ? team.roster.map((p) => p.id) : [])
  const keep = (id: string | undefined): string => (id && ids.has(id) ? id : '')
  const sanitize = (rows: string[][] | undefined, nLines: number, slotLen: number): string[][] => {
    const out: string[][] = []
    for (let i = 0; i < nLines; i++) {
      const row: string[] = []
      for (let j = 0; j < slotLen; j++) row.push(keep(rows?.[i]?.[j]))
      out.push(row)
    }
    return out
  }
  s.userLines = {
    forwards: sanitize(lines.forwards, 4, 3),
    defense: sanitize(lines.defense, 3, 2),
    goalies: [keep(lines.goalies?.[0]), keep(lines.goalies?.[1])],
  }
  return s
}

// ---- trades ---------------------------------------------------------------
export function evaluateTrade(s: GameState, offer: TradeOffer): { accept: boolean; verdict: string; delta: number } {
  return evaluateTradeCore(s, offer)
}
export function executeTrade(s: GameState, offer: TradeOffer): { s: GameState; ok: boolean; reason?: string } {
  return withResult(s, (st) => executeTradeCore(st, offer))
}
export function getAiTradeSuggestion(s: GameState, partner: string): TradeOffer | null {
  return getAiTradeSuggestionCore(s, partner)
}
export function getAiTradeSuggestionFor(s: GameState, partner: string, playerId: string): TradeOffer | null {
  return getAiTradeSuggestionForCore(s, partner, playerId)
}
/** Ranked fair trade packages (top 3 partners) for a user-team player. */
export function getTradeOptionsFor(s: GameState, playerId: string): TradeOffer[] {
  return getTradeOptionsForCore(s, playerId)
}
/** Respond to an incoming AI trade offer. Accept re-validates + executes it. */
export function respondToOffer(s: GameState, offerId: number, accept: boolean): { s: GameState; ok: boolean; reason?: string } {
  return withResult(s, (st) => respondToOfferCore(st, offerId, accept))
}
/** Toggle a user-team roster player on/off the trade block. */
export function toggleTradeBlock(s: GameState, playerId: string): GameState {
  return withRng(s, (st, rng) => {
    const i = st.tradeBlock.indexOf(playerId)
    if (i >= 0) {
      st.tradeBlock.splice(i, 1)
      return
    }
    // User-team roster players AND prospects may be added.
    const team = st.teams[st.userTeam]
    if (team?.roster.some((p) => p.id === playerId) || team?.prospects.some((p) => p.id === playerId)) {
      st.tradeBlock.push(playerId)
      // Immediately shop him — teams start calling right away.
      generateBlockOffers(st, rng, playerId)
    }
    pruneTradeBlock(st)
  })
}

// ---- read-only views ------------------------------------------------------
export function getStandings(s: GameState): { league: StandingsRow[]; byDivision: Record<Division, StandingsRow[]> } {
  return standingsView(s)
}

function positionOf(s: GameState, id: string): Player['pos'] | undefined {
  for (const abbr of Object.keys(s.teams)) {
    const t = s.teams[abbr]
    const p = t.roster.find((x) => x.id === id) ?? t.prospects.find((x) => x.id === id)
    if (p) return p.pos
  }
  return undefined
}

export function getLeaders(s: GameState): { points: SeasonStatLine[]; goals: SeasonStatLine[]; assists: SeasonStatLine[]; goalies: SeasonStatLine[] } {
  const skaters: SeasonStatLine[] = []
  const goalies: SeasonStatLine[] = []
  for (const id of Object.keys(s.stats)) {
    const line = s.stats[id]
    const pos = positionOf(s, id)
    if (pos === 'G') goalies.push(line)
    else if (pos) skaters.push(line)
  }
  const points = [...skaters].sort((a, b) => b.points - a.points || b.goals - a.goals).slice(0, 20)
  const goals = [...skaters].sort((a, b) => b.goals - a.goals || b.points - a.points).slice(0, 20)
  const assists = [...skaters].sort((a, b) => b.assists - a.assists || b.points - a.points).slice(0, 20)
  const goalieLeaders = [...goalies].sort((a, b) => (b.svPct ?? 0) - (a.svPct ?? 0) || (b.wins ?? 0) - (a.wins ?? 0)).slice(0, 20)
  return { points, goals, assists, goalies: goalieLeaders }
}

export function getCapUsage(s: GameState, team: string): { used: number; cap: number; space: number; capYear: number } {
  const t = s.teams[team]
  // Offseason signings/trades count against NEXT season's cap; report the same
  // basis the engine enforces so the UI space never jumps between screens.
  const offseason = s.phase === 'offseason'
  const cap = offseason ? nextCap(s.seasonYear) : currentCap(s.seasonYear)
  const capYear = offseason ? s.seasonYear + 1 : s.seasonYear
  // Offseason reports COMMITTED cap only: an expiring player's dead 0-year hit is
  // excluded so re-signing him below his old AAV correctly REDUCES displayed space
  // (previously the dead hit inflated `used` and space jumped the wrong way).
  const used = t ? (offseason ? committedCapUsed(t) : teamCapUsed(t)) : 0
  return { used, cap, space: Math.round((cap - used) * 1000) / 1000, capYear }
}

export function findPlayer(s: GameState, id: string): { player: Player; team?: string } | null {
  for (const abbr of Object.keys(s.teams)) {
    const t = s.teams[abbr]
    const rp = t.roster.find((x) => x.id === id) ?? t.prospects.find((x) => x.id === id)
    if (rp) return { player: rp, team: abbr }
  }
  const fa = s.freeAgents.find((x) => x.id === id)
  if (fa) return { player: fa }
  const dp = s.draftClass.find((x) => x.id === id)
  if (dp) return { player: dp }
  return null
}

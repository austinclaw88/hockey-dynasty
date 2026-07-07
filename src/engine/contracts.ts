// Contract asking prices and cap helpers. Asking prices are DETERMINISTIC
// (hash-based per-player variation) so the UI can query them repeatedly without
// consuming or mutating RNG state.
import type { Player, GameState, FreeAgent } from '../types.ts'
import { hash01 } from './rng.ts'
import { clamp, nextCap, currentCap } from './helpers.ts'

export interface Asking {
  capHit: number
  years: number
}

/** Percentage-of-cap band by overall (returns [lo, hi] as fractions, or a flat
 *  $M range for depth players tagged with `flat`). */
function band(overall: number): { lo: number; hi: number; flat?: boolean } {
  if (overall >= 95) return { lo: 0.14, hi: 0.15 }
  if (overall >= 90) return { lo: 0.1, hi: 0.13 }
  if (overall >= 85) return { lo: 0.07, hi: 0.095 }
  if (overall >= 80) return { lo: 0.045, hi: 0.065 }
  if (overall >= 75) return { lo: 0.02, hi: 0.04 }
  if (overall >= 70) return { lo: 0.01, hi: 0.018 }
  return { lo: 0.85, hi: 1.0, flat: true }
}

function askingYears(p: Player): number {
  const o = p.overall
  const young = p.age <= 25 && p.potential >= p.overall + 4
  if (o >= 88) return young ? 8 : 7
  if (o >= 84) return young ? 7 : 6
  if (o >= 80) return young ? 6 : 4
  if (o >= 76) return 4
  if (o >= 72) return young ? 4 : 3
  return p.age >= 32 ? 1 : 2
}

/** Compute asking price for a player becoming a free agent / re-signing. */
export function askingFor(p: Player, cap: number): Asking {
  const b = band(p.overall)
  const t = hash01(p.id + ':ask') // stable 0..1
  let capHit: number
  if (b.flat) {
    capHit = b.lo + t * (b.hi - b.lo)
  } else {
    const pct = b.lo + t * (b.hi - b.lo)
    capHit = pct * cap
  }
  // Age discount for veterans.
  if (p.age >= 30) capHit *= 1 - clamp((p.age - 29) * 0.03 + 0.07, 0.1, 0.2)
  // RFA discount.
  const isRFA = p.contract?.expiry === 'RFA' || p.age < 27
  if (isRFA) capHit *= 0.85
  capHit = Math.max(0.775, Math.round(capHit * 1000) / 1000)
  let years = askingYears(p)
  // Older players get shorter term regardless.
  if (p.age >= 34) years = Math.min(years, 2)
  else if (p.age >= 32) years = Math.min(years, 3)
  return { capHit, years }
}

/** Is a signing at (years, capHit) acceptable vs asking? For UFA logic. */
export function signingOutcome(ask: Asking, capHit: number, rng01: number): { ok: boolean; reason?: string } {
  const ratio = capHit / ask.capHit
  if (ratio >= 1) return { ok: true }
  if (ratio >= 0.9) {
    if (rng01 < 0.5) return { ok: true }
    return { ok: false, reason: 'Player declined — wanted more.' }
  }
  return { ok: false, reason: 'Offer below what the player will accept.' }
}

// ---- signing incentives (NTC + term) --------------------------------------
// A player's EFFECTIVE ask is his base ask adjusted for the sweeteners a GM
// bundles into the offer:
//   • a no-trade clause lowers the cap he'll accept (veterans value security);
//   • extra term above what he asked lowers it a little (guaranteed money);
//   • short-changing him on term raises it (he wants the security back in cash).
// The functions are pure/deterministic so the UI can query a live preview.

/** True for players who actually value a no-trade clause: established veterans. */
function valuesNtc(p: Player): boolean {
  return p.age >= 27 && p.overall >= 80
}

/** Effective cap-hit the player will accept given the term offered and whether a
 *  no-trade clause is on the table. Base ask comes from `askingFor`. */
export function effectiveAsk(ask: Asking, p: Player, years: number, ntc: boolean): number {
  let mult = 1
  if (ntc) mult *= valuesNtc(p) ? 0.93 : 0.98 // ~7% for veterans, ~2% otherwise
  const extra = years - ask.years
  if (extra > 0) mult *= 1 - Math.min(0.06, extra * 0.03) // more term: up to -6%
  else if (extra < 0) mult *= 1 + -extra * 0.04 // fewer years: +4% per missing year
  return Math.max(0.775, Math.round(ask.capHit * mult * 1000) / 1000)
}

/** Extra discount a player gives his current club when signing a MID-SEASON
 *  extension in the final year of his deal — loyalty / avoiding free agency. */
export const LOYALTY_DISCOUNT = 0.03

/** Effective ask for a mid-season extension: the standard effective ask with the
 *  loyalty discount applied on top. Shared by the live preview and extendPlayer. */
export function extensionEffectiveAsk(ask: Asking, p: Player, years: number, ntc: boolean): number {
  const base = effectiveAsk(ask, p, years, ntc)
  return Math.max(0.775, Math.round(base * (1 - LOYALTY_DISCOUNT) * 1000) / 1000)
}

export type SigningVerdict = 'certain' | 'likely' | 'coin flip' | 'unlikely' | 'rejected'

/** Descriptive verdict for a UI negotiation meter, given the offer ratio vs the
 *  effective ask. RFA hard-accept threshold is 90%; UFA is a coin flip 90-100%. */
export function signingVerdict(ratio: number, isRFA: boolean): SigningVerdict {
  if (isRFA) {
    if (ratio >= 1.0) return 'certain'
    if (ratio >= 0.95) return 'likely'
    if (ratio >= 0.9) return 'coin flip'
    if (ratio >= 0.85) return 'unlikely'
    return 'rejected'
  }
  if (ratio >= 1.05) return 'certain'
  if (ratio >= 1.0) return 'likely'
  if (ratio >= 0.9) return 'coin flip'
  if (ratio >= 0.82) return 'unlikely'
  return 'rejected'
}

/** Live signing preview for the UI negotiation meter. Works for pool free agents
 *  (asking carried on the FreeAgent), the user's own expiring players in the
 *  offseason re-sign step (asking via askingFor), and MID-SEASON extensions of a
 *  user roster player in his contract's final year (yearsLeft === 1 during the
 *  regular season — asking via askingFor with the loyalty discount). Pure. */
export function getSigningPreview(
  s: GameState,
  playerId: string,
  years: number,
  capHit: number,
  ntc: boolean,
): { effectiveAsk: number; verdict: SigningVerdict } {
  const fa = s.freeAgents.find((x) => x.id === playerId) as FreeAgent | undefined
  if (fa) {
    const eff = effectiveAsk(fa.asking, fa, years, ntc)
    return { effectiveAsk: eff, verdict: signingVerdict(capHit / eff, fa.age < 27) }
  }
  const p = s.teams[s.userTeam]?.roster.find((x) => x.id === playerId)
  if (!p) return { effectiveAsk: capHit, verdict: 'rejected' }
  const isExtension = s.phase === 'regular' && !!p.contract && p.contract.yearsLeft === 1
  const cap = isExtension ? currentCap(s.seasonYear) : nextCap(s.seasonYear)
  const ask = askingFor(p, cap)
  const eff = isExtension ? extensionEffectiveAsk(ask, p, years, ntc) : effectiveAsk(ask, p, years, ntc)
  const isRFA = p.age < 27 || p.contract?.expiry === 'RFA'
  return { effectiveAsk: eff, verdict: signingVerdict(capHit / eff, isRFA) }
}

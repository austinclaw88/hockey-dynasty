// Contract asking prices and cap helpers. Asking prices are DETERMINISTIC
// (hash-based per-player variation) so the UI can query them repeatedly without
// consuming or mutating RNG state.
import type { Player } from '../types.ts'
import { hash01 } from './rng.ts'
import { clamp } from './helpers.ts'

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

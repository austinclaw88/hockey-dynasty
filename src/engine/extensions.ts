// Mid-season contract extensions. A user-team player in the final year of his
// deal (yearsLeft === 1) can be re-upped during the regular season; the new AAV
// applies immediately (single-AAV convention). AI teams quietly extend their own
// expiring stars mid-season so fewer of them hit the offseason market.
import type { GameState, Player, ExpiryStatus } from '../types.ts'
import type { Rng } from './rng.ts'
import { currentCap, teamCapUsed, ext, pushNews } from './helpers.ts'
import { askingFor, extensionEffectiveAsk, signingOutcome } from './contracts.ts'

/** Expiry status of an extended deal, keyed on the player's age when it expires. */
function expiryByExpiryAge(ageAtExpiry: number): ExpiryStatus {
  return ageAtExpiry < 27 ? 'RFA' : 'UFA'
}

/** User extends a roster player whose contract has one year left. Returns
 *  ok/reason and mutates `s`. Offering an NTC / extra term lowers the effective
 *  ask (plus a loyalty discount); the new AAV must fit the CURRENT season cap. */
export function doExtendPlayer(s: GameState, playerId: string, years: number, capHit: number, rng: Rng, ntc = false): { ok: boolean; reason?: string } {
  if (s.phase !== 'regular') return { ok: false, reason: 'Extensions are only offered during the regular season.' }
  if (years < 1) return { ok: false, reason: 'An extension must add at least one year.' }
  const team = s.teams[s.userTeam]
  const p = team.roster.find((x) => x.id === playerId)
  if (!p || !p.contract || p.contract.yearsLeft !== 1) {
    return { ok: false, reason: 'Only players in the final year of their contract can be extended.' }
  }
  const cap = currentCap(s.seasonYear)
  const oldHit = p.contract.capHit
  const newHit = Math.round(capHit * 1000) / 1000
  // The new AAV applies immediately, so it must fit the current cap in place of
  // the old hit.
  if (teamCapUsed(team) - oldHit + newHit > cap + 0.001) return { ok: false, reason: 'Not enough cap space.' }
  const ask = askingFor(p, cap)
  const eff = extensionEffectiveAsk(ask, p, years, ntc)
  const isRFA = p.age < 27 || p.contract.expiry === 'RFA'
  if (isRFA) {
    if (capHit < eff * 0.9) return { ok: false, reason: 'Offer too low — the player will not extend.' }
  } else {
    const outcome = signingOutcome({ capHit: eff, years }, capHit, rng.next())
    if (!outcome.ok) return { ok: false, reason: outcome.reason }
  }
  const newYears = 1 + years
  p.contract = {
    capHit: newHit,
    yearsLeft: newYears,
    expiry: expiryByExpiryAge(p.age + newYears),
    ntc: ntc || p.contract.ntc,
  }
  pushNews(s, `${p.name} signs a contract extension with ${s.userTeam} (${newHit.toFixed(2)}M x${years}${ntc ? ', NTC' : ''}).`)
  return { ok: true }
}

/** AI teams extend their own expiring 83+ OVR players once per regular season
 *  (fired in the day 40-80 window). Each qualifying player is extended with 65%
 *  probability so some stars still reach the offseason re-sign step. */
export function aiMidSeasonExtensions(s: GameState, day: number, rng: Rng): void {
  if (s.phase !== 'regular') return
  if (day < 40 || day > 80) return
  const es = ext(s)
  if (es._extSeason === s.seasonYear) return
  es._extSeason = s.seasonYear
  const cap = currentCap(s.seasonYear)
  for (const abbr of Object.keys(s.teams)) {
    if (abbr === s.userTeam) continue
    const team = s.teams[abbr]
    const expiring = team.roster.filter((p): p is Player & { contract: NonNullable<Player['contract']> } => !!p.contract && p.contract.yearsLeft === 1 && p.overall >= 83)
    for (const p of expiring) {
      if (!rng.chance(0.65)) continue
      const ask = askingFor(p, cap)
      const oldHit = p.contract.capHit
      const newHit = ask.capHit
      if (teamCapUsed(team) - oldHit + newHit > cap + 0.001) continue
      const newYears = 1 + ask.years
      p.contract = {
        capHit: newHit,
        yearsLeft: newYears,
        expiry: expiryByExpiryAge(p.age + newYears),
        ntc: p.contract.ntc,
      }
      pushNews(s, `${p.name} signs a contract extension with ${abbr} (${newHit.toFixed(2)}M x${ask.years}).`)
    }
  }
}

// Roster moves: call up prospects / send players down.
import type { GameState } from '../types.ts'
import { ROSTER_MAX, ROSTER_MIN } from '../types.ts'
import { currentCap, teamCapUsed, rosterCounts } from './helpers.ts'

export function doCallUp(s: GameState, playerId: string): { ok: boolean; reason?: string } {
  const team = s.teams[s.userTeam]
  const idx = team.prospects.findIndex((p) => p.id === playerId)
  if (idx < 0) return { ok: false, reason: 'Player is not a prospect on your team.' }
  if (team.roster.length >= ROSTER_MAX) return { ok: false, reason: 'Roster is full (23).' }
  const p = team.prospects[idx]
  const cap = currentCap(s.seasonYear)
  const capHit = p.contract?.capHit ?? 0.95
  if (teamCapUsed(team) + capHit > cap + 0.001) return { ok: false, reason: 'Not enough cap space.' }
  team.prospects.splice(idx, 1)
  if (!p.contract) p.contract = { capHit: 0.95, yearsLeft: 3, expiry: 'RFA' }
  team.roster.push(p)
  return { ok: true }
}

export function doSendDown(s: GameState, playerId: string): { ok: boolean; reason?: string } {
  const team = s.teams[s.userTeam]
  const idx = team.roster.findIndex((p) => p.id === playerId)
  if (idx < 0) return { ok: false, reason: 'Player is not on your roster.' }
  const p = team.roster[idx]
  if (p.age > 25 || p.overall > 78) return { ok: false, reason: 'Only players aged <=25 and <=78 OVR can be sent down.' }
  if (team.roster.length <= ROSTER_MIN) return { ok: false, reason: 'Roster is at the minimum (20).' }
  const c = rosterCounts(team)
  const ok = p.pos === 'G' ? c.g > 2 : p.pos === 'D' ? c.d > 6 : c.f > 12
  if (!ok) return { ok: false, reason: 'Sending down would break a position minimum.' }
  team.roster.splice(idx, 1)
  team.prospects.push(p)
  return { ok: true }
}

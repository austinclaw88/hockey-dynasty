// Free agency: building the FA pool, AI signings per day, and user signings.
import type { GameState, Player, FreeAgent, Position, TeamState } from '../types'
import { ROSTER_MAX } from '../types'
import type { Rng } from './rng'
import { askingFor, signingOutcome } from './contracts'
import { generateName, pickNationality } from './names'
import { currentCap, nextCap, teamCapUsed, rosterCounts, isForward, pushNews } from './helpers'

export function toFreeAgent(p: Player, cap: number): FreeAgent {
  const fa: FreeAgent = { ...p, contract: null, injuryWeeks: 0, asking: askingFor(p, cap) }
  return fa
}

/** Generate journeyman/veteran filler free agents so AI can fill rosters. */
function generateVeteranFA(rng: Rng, cap: number, year: number, i: number): FreeAgent {
  const roll = rng.next()
  const pos: Position = roll < 0.6 ? (rng.chance(0.5) ? 'C' : rng.chance(0.5) ? 'LW' : 'RW') : roll < 0.85 ? 'D' : 'G'
  const overall = rng.int(70, 82)
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
  const fillers = 30
  const start = s.freeAgents.length
  for (let i = 0; i < fillers; i++) {
    s.freeAgents.push(generateVeteranFA(rng, cap, s.seasonYear, start + i))
  }
  // Sort by overall so "best available" is meaningful for the UI.
  s.freeAgents.sort((a, b) => b.overall - a.overall)
  s.day = 0
}

function positionNeed(team: TeamState): Position | null {
  const c = rosterCounts(team)
  if (c.g < 2) return 'G'
  if (c.d < 6) return 'D'
  if (c.f < 12) return 'C'
  return null
}

function signToTeam(s: GameState, team: TeamState, fa: FreeAgent, years: number, cap: number): void {
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
    contract: { capHit: fa.asking.capHit, yearsLeft: years, expiry },
  }
  team.roster.push(player)
  s.freeAgents = s.freeAgents.filter((x) => x.id !== fa.id)
}

/** One FA day of AI signings. Stars sign only on days 0-1. */
export function aiFreeAgencyDay(s: GameState, rng: Rng): void {
  const cap = nextCap(s.seasonYear)
  const teams = rng.shuffle(Object.keys(s.teams).filter((a) => a !== s.userTeam))
  for (const abbr of teams) {
    const team = s.teams[abbr]
    let signings = 0
    const maxSignings = rng.int(1, 2)
    while (signings < maxSignings) {
      const space = cap - teamCapUsed(team)
      const counts = rosterCounts(team)
      if (counts.total >= ROSTER_MAX) break
      const need = positionNeed(team)
      // Pick best affordable FA matching need (or best overall if roster full-ish).
      let target: FreeAgent | undefined
      for (const fa of s.freeAgents) {
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
      signToTeam(s, team, target, target.asking.years, cap)
      if (target.overall >= 80) pushNews(s, `${target.name} signs with ${abbr} (${target.asking.capHit.toFixed(2)}M x${target.asking.years}).`)
      signings++
    }
  }
}

/** User signs a free agent. Returns ok/reason; mutates `s`. */
export function doSignFreeAgent(s: GameState, playerId: string, years: number, capHit: number, rng: Rng): { ok: boolean; reason?: string } {
  const fa = s.freeAgents.find((x) => x.id === playerId)
  if (!fa) return { ok: false, reason: 'Player is not a free agent.' }
  const cap = nextCap(s.seasonYear)
  const team = s.teams[s.userTeam]
  if (rosterCounts(team).total >= ROSTER_MAX) return { ok: false, reason: 'Roster is full (23).' }
  if (teamCapUsed(team) + capHit > cap + 0.001) return { ok: false, reason: 'Not enough cap space.' }
  const outcome = signingOutcome(fa.asking, capHit, rng.next())
  if (!outcome.ok) return { ok: false, reason: outcome.reason }
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
    contract: { capHit: Math.round(capHit * 1000) / 1000, yearsLeft: years, expiry },
  }
  team.roster.push(player)
  s.freeAgents = s.freeAgents.filter((x) => x.id !== fa.id)
  pushNews(s, `${player.name} signs with ${s.userTeam} (${capHit.toFixed(2)}M x${years}).`)
  return { ok: true }
}

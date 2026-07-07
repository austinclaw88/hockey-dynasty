// Offseason player development: aging, progression/regression, retirement.
import type { GameState, Player, TeamState } from '../types.ts'
import type { Rng } from './rng.ts'
import { clamp, isGoalie, pushNews } from './helpers.ts'
import { effectiveLines } from './sim.ts'

/** Progression/regression delta range by (goalie-shifted) age. */
function bandDelta(age: number, goalie: boolean, rng: Rng): number {
  const a = goalie ? age - 2 : age // goalies develop later / last longer
  if (a <= 22) return rng.int(1, 5)
  if (a <= 25) return rng.int(0, 3)
  if (a <= 29) return rng.int(-1, 1)
  if (a <= 32) return rng.int(-2, 0)
  if (a <= 35) return rng.int(-3, -1)
  return rng.int(-5, -2)
}

/** Nudge from last season's scoring vs. expectation. */
function performanceAdj(s: GameState, p: Player): number {
  const line = s.stats[p.id]
  if (!line || line.gp < 20) return 0
  if (isGoalie(p)) {
    const sv = line.svPct ?? 0
    if (sv >= 0.915) return 1
    if (sv > 0 && sv < 0.89) return -1
    return 0
  }
  const per82 = (line.points / line.gp) * 82
  const expected = clamp((p.overall - 60) * 1.6, 5, 95)
  if (per82 > expected * 1.25) return 1
  if (per82 < expected * 0.55) return -1
  return 0
}

/** Playing-time bias on the growth roll (item 3): a young, still-developing
 *  skater who logged top-6 F / top-4 D minutes last season gets +1 (grows
 *  faster toward potential); one scratched to the pressbox (not in the 18-skater
 *  lineup) gets -1. Applied only to age<=23 skaters whose potential exceeds
 *  overall; the potential cap still holds. Prospects/goalies: neutral. */
function usageBias(team: TeamState, s: GameState): Map<string, number> {
  const lines = effectiveLines(s, team.abbrev)
  const inLineup = new Set<string>()
  const top = new Set<string>()
  lines.forwards.forEach((line, li) => {
    for (const id of line) {
      if (!id) continue
      inLineup.add(id)
      if (li < 2) top.add(id) // top-6 F = lines 1-2
    }
  })
  lines.defense.forEach((pair, pi) => {
    for (const id of pair) {
      if (!id) continue
      inLineup.add(id)
      if (pi < 2) top.add(id) // top-4 D = pairs 1-2
    }
  })
  const map = new Map<string, number>()
  for (const p of team.roster) {
    if (isGoalie(p)) continue
    if (top.has(p.id)) map.set(p.id, 1)
    else if (!inLineup.has(p.id)) map.set(p.id, -1)
    else map.set(p.id, 0)
  }
  return map
}

function developPlayer(s: GameState, p: Player, rng: Rng, bias = 0): void {
  const seasonAge = p.age // age during the season just played (usage was earned at this age)
  p.age += 1
  const goalie = isGoalie(p)
  let delta = bandDelta(p.age, goalie, rng) + performanceAdj(s, p)
  // Playing time accelerates (or stalls) development for young, unfinished skaters.
  if (!goalie && seasonAge <= 23 && p.potential > p.overall) delta += bias
  // Young players progress toward potential, never exceeding it.
  p.overall = clamp(p.overall + delta, 25, 99)
  if (p.age >= 27) {
    p.potential = p.overall // peaked
  } else {
    p.potential = Math.max(p.potential, p.overall)
    p.overall = Math.min(p.overall, p.potential)
  }
}

/** Retirement probability after decline (goalies shifted +2 years). */
function retires(p: Player, rng: Rng): boolean {
  const a = isGoalie(p) ? p.age - 2 : p.age
  if (a >= 41) return true
  if (a >= 38) return rng.chance(0.6)
  if (a >= 35 && p.overall < 74) return rng.chance(0.5)
  if (a >= 33 && p.overall < 70) return rng.chance(0.4)
  return false
}

export interface DevReport {
  changes: { id: string; name: string; team: string; from: number; to: number }[]
  retirements: { id: string; name: string; team: string; overall: number }[]
}

export function runDevelopment(s: GameState, rng: Rng): DevReport {
  const report: DevReport = { changes: [], retirements: [] }
  for (const abbr of Object.keys(s.teams)) {
    const team: TeamState = s.teams[abbr]
    // Usage bias is measured from the FINAL (end-of-season) lineup, before any
    // player is developed/removed — roster players only; prospects stay neutral.
    const bias = usageBias(team, s)
    const survivorsRoster: Player[] = []
    const survivorsProspects: Player[] = []
    for (const list of [team.roster, team.prospects] as const) {
      const keep = list === team.roster ? survivorsRoster : survivorsProspects
      for (const p of list) {
        const before = p.overall
        developPlayer(s, p, rng, bias.get(p.id) ?? 0)
        if (p.overall !== before) {
          report.changes.push({ id: p.id, name: p.name, team: abbr, from: before, to: p.overall })
        }
        if (retires(p, rng)) {
          p.retired = true
          report.retirements.push({ id: p.id, name: p.name, team: abbr, overall: before })
          if (before >= 85) pushNews(s, `${p.name} (${abbr}) has retired after a distinguished career.`)
        } else {
          keep.push(p)
        }
      }
    }
    team.roster = survivorsRoster
    team.prospects = survivorsProspects
  }
  return report
}

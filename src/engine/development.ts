// Offseason player development: aging, progression/regression, retirement.
import type { GameState, Player, TeamState } from '../types'
import type { Rng } from './rng'
import { clamp, isGoalie, pushNews } from './helpers'

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

function developPlayer(s: GameState, p: Player, rng: Rng): void {
  p.age += 1
  const goalie = isGoalie(p)
  let delta = bandDelta(p.age, goalie, rng) + performanceAdj(s, p)
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
    const survivorsRoster: Player[] = []
    const survivorsProspects: Player[] = []
    for (const list of [team.roster, team.prospects] as const) {
      const keep = list === team.roster ? survivorsRoster : survivorsProspects
      for (const p of list) {
        const before = p.overall
        developPlayer(s, p, rng)
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

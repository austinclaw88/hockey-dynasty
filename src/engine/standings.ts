// Standings computation from played games, plus playoff seeding.
import type { GameState, StandingsRow, Division, Conference } from '../types'

export function computeStandings(s: GameState): Record<string, StandingsRow> {
  const rows: Record<string, StandingsRow> = {}
  for (const abbr of Object.keys(s.teams)) {
    rows[abbr] = { team: abbr, gp: 0, w: 0, l: 0, otl: 0, pts: 0, gf: 0, ga: 0 }
  }
  for (const g of s.schedule) {
    if (!g.played || g.homeGoals === undefined || g.awayGoals === undefined) continue
    const h = rows[g.home]
    const a = rows[g.away]
    if (!h || !a) continue
    h.gp++
    a.gp++
    h.gf += g.homeGoals
    h.ga += g.awayGoals
    a.gf += g.awayGoals
    a.ga += g.homeGoals
    const homeWon = g.homeGoals > g.awayGoals
    const extra = g.endType === 'OT' || g.endType === 'SO'
    if (homeWon) {
      h.w++
      if (extra) a.otl++
      else a.l++
    } else {
      a.w++
      if (extra) h.otl++
      else h.l++
    }
  }
  for (const abbr of Object.keys(rows)) {
    const r = rows[abbr]
    r.pts = r.w * 2 + r.otl
  }
  return rows
}

export function sortRows(rows: StandingsRow[]): StandingsRow[] {
  return [...rows].sort(
    (a, b) => b.pts - a.pts || b.w - a.w || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || a.team.localeCompare(b.team),
  )
}

export interface StandingsView {
  league: StandingsRow[]
  byDivision: Record<Division, StandingsRow[]>
}

const DIVISIONS: Division[] = ['Atlantic', 'Metropolitan', 'Central', 'Pacific']

export function standingsView(s: GameState): StandingsView {
  const rows = computeStandings(s)
  const all = Object.values(rows)
  const byDivision = {} as Record<Division, StandingsRow[]>
  for (const div of DIVISIONS) {
    byDivision[div] = sortRows(all.filter((r) => s.teams[r.team].division === div))
  }
  return { league: sortRows(all), byDivision }
}

/** Reverse standings order (worst first) — for draft lottery / order. */
export function reverseStandingsOrder(s: GameState): string[] {
  const rows = sortRows(Object.values(computeStandings(s)))
  return rows.map((r) => r.team).reverse()
}

// ---- playoff seeding ------------------------------------------------------
export interface Seed {
  team: string
  code: string // e.g. 'A1', 'WC2'
}

/** Top 3 per division + 2 wildcards per conference. Returns seeds per conf. */
export function playoffSeeds(s: GameState): Record<Conference, Seed[]> {
  const rows = computeStandings(s)
  const all = Object.values(rows)
  const result = {} as Record<Conference, Seed[]>
  const confDivs: Record<Conference, Division[]> = {
    East: ['Atlantic', 'Metropolitan'],
    West: ['Central', 'Pacific'],
  }
  for (const conf of ['East', 'West'] as Conference[]) {
    const divs = confDivs[conf]
    const seeds: Seed[] = []
    const claimed = new Set<string>()
    const divTop: Record<string, StandingsRow[]> = {}
    for (const div of divs) {
      const sorted = sortRows(all.filter((r) => s.teams[r.team].division === div))
      divTop[div] = sorted
      const top3 = sorted.slice(0, 3)
      top3.forEach((r, i) => {
        seeds.push({ team: r.team, code: `${div[0]}${i + 1}` })
        claimed.add(r.team)
      })
    }
    // Wildcards: best two remaining in the conference by points.
    const confTeams = all.filter((r) => s.teams[r.team].conference === conf && !claimed.has(r.team))
    const wc = sortRows(confTeams).slice(0, 2)
    wc.forEach((r, i) => seeds.push({ team: r.team, code: `WC${i + 1}` }))
    result[conf] = seeds
  }
  return result
}

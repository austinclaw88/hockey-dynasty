// Season-end awards + SeasonSummary construction.
import type { CareerSeason, GameState, Player, SeasonSummary, StandingsRow } from '../types.ts'
import { computeStandings, sortRows } from './standings.ts'
import { cupResult, userPlayoffFinish } from './playoffs.ts'
import { pushNews } from './helpers.ts'

interface PT {
  player: Player
  team: string
}

function allRostered(s: GameState): Map<string, PT> {
  const m = new Map<string, PT>()
  for (const abbr of Object.keys(s.teams)) {
    for (const p of s.teams[abbr].roster) m.set(p.id, { player: p, team: abbr })
    for (const p of s.teams[abbr].prospects) m.set(p.id, { player: p, team: abbr })
  }
  return m
}

/** Build awards, season summary, milestone + award news. Mutates `s`. */
export function buildSeasonSummary(s: GameState): void {
  const rows = sortRows(Object.values(computeStandings(s)))
  const presidents = rows[0]?.team ?? s.userTeam
  const cup = cupResult(s)
  const map = allRostered(s)

  // Collect scorers with enough games.
  const skaters: { pt: PT; pts: number; g: number; a: number; pm: number }[] = []
  const goalies: { pt: PT; sv: number; w: number; starts: number }[] = []
  for (const [id, line] of Object.entries(s.stats)) {
    const pt = map.get(id)
    if (!pt) continue
    if (pt.player.pos === 'G') {
      goalies.push({ pt, sv: line.svPct ?? 0, w: line.wins ?? 0, starts: line.gp })
    } else {
      skaters.push({ pt, pts: line.points, g: line.goals, a: line.assists, pm: line.plusMinus })
    }
  }

  const byPoints = [...skaters].sort((a, b) => b.pts - a.pts || b.pm - a.pm)
  const byGoals = [...skaters].sort((a, b) => b.g - a.g || b.pts - a.pts)
  const dmen = byPoints.filter((x) => x.pt.player.pos === 'D')
  const rookies = byPoints.filter((x) => x.pt.player.age <= 22)
  const vezPool = goalies.filter((g) => g.starts >= 41)
  const vezFallback = goalies.filter((g) => g.w >= 30)
  const vezSorted = (vezPool.length ? vezPool : vezFallback.length ? vezFallback : goalies).sort((a, b) => b.sv - a.sv || b.w - a.w)

  const awards: SeasonSummary['awards'] = []
  const add = (name: string, x: PT | undefined): void => {
    if (!x) return
    awards.push({ name, playerId: x.player.id, playerName: x.player.name, team: x.team })
  }
  add('Hart Trophy', byPoints[0]?.pt)
  add('Art Ross Trophy', byPoints[0]?.pt)
  add('Rocket Richard', byGoals[0]?.pt)
  add('Norris Trophy', dmen[0]?.pt)
  add('Vezina Trophy', vezSorted[0]?.pt)
  add('Calder Trophy', rookies[0]?.pt)

  for (const a of awards) pushNews(s, `AWARD: ${a.playerName} (${a.team}) wins the ${a.name}.`)

  // Milestones.
  for (const sk of skaters) {
    if (sk.g >= 50) pushNews(s, `MILESTONE: ${sk.pt.player.name} (${sk.pt.team}) scored ${sk.g} goals this season.`)
    if (sk.pts >= 100) pushNews(s, `MILESTONE: ${sk.pt.player.name} (${sk.pt.team}) posted a ${sk.pts}-point season.`)
  }

  const userRow = rows.find((r) => r.team === s.userTeam)
  const userFinish = buildUserFinish(s, rows)
  const topScorers = byPoints.slice(0, 10).map((x) => ({ playerName: x.pt.player.name, team: x.pt.team, points: x.pts, goals: x.g }))

  const summary: SeasonSummary = {
    year: s.seasonYear,
    presidentsTrophy: presidents,
    cupWinner: cup?.winner ?? presidents,
    cupRunnerUp: cup?.runnerUp ?? '',
    userFinish,
    awards,
    topScorers,
    userRecord: {
      w: userRow?.w ?? 0,
      l: userRow?.l ?? 0,
      otl: userRow?.otl ?? 0,
      pts: userRow?.pts ?? 0,
    },
  }
  s.history.push(summary)

  archiveCareerSeasons(s, map)

  if (cup) pushNews(s, `The ${s.teams[cup.winner].name} win the Stanley Cup!`)
}

/**
 * Append one CareerSeason entry per player with a stat line of gp > 0 this
 * season, keyed by playerId. Team is resolved from the current roster/prospects
 * (traded players get their current team). Archives persist forever — retiring
 * or leaving the league never removes prior entries.
 */
function archiveCareerSeasons(s: GameState, map: Map<string, PT>): void {
  for (const [id, line] of Object.entries(s.stats)) {
    if (line.gp <= 0) continue
    const team = map.get(id)?.team ?? ''
    const entry: CareerSeason = {
      year: s.seasonYear,
      team,
      gp: line.gp,
      goals: line.goals,
      assists: line.assists,
      points: line.points,
      plusMinus: line.plusMinus,
      pim: line.pim,
    }
    if (line.wins !== undefined) entry.wins = line.wins
    if (line.losses !== undefined) entry.losses = line.losses
    if (line.otl !== undefined) entry.otl = line.otl
    if (line.shutouts !== undefined) entry.shutouts = line.shutouts
    if (line.gaa !== undefined) entry.gaa = line.gaa
    if (line.svPct !== undefined) entry.svPct = line.svPct
    ;(s.careers[id] ??= []).push(entry)
  }
}

function buildUserFinish(s: GameState, rows: StandingsRow[]): string {
  const playoff = userPlayoffFinish(s, s.userTeam)
  if (playoff) return playoff
  // Missed playoffs: report division placement.
  const div = s.teams[s.userTeam].division
  const divRows = rows.filter((r) => s.teams[r.team].division === div)
  const place = divRows.findIndex((r) => r.team === s.userTeam) + 1
  const ord = place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`
  return `Missed playoffs (${ord} in ${div})`
}

// New-game setup: builds the full 32-team league from team data and generates
// the first season's schedule.
import type { GameState, TeamState, Player, DraftPick, TeamDataFile } from '../types.ts'
import { START_YEAR, SEASONS_TOTAL } from '../types.ts'
import { Rng, seedFrom } from './rng.ts'
import { buildSchedule } from './schedule.ts'
import { avg } from './helpers.ts'

function hydratePlayer(raw: Omit<Player, 'injuryWeeks' | 'retired'>): Player {
  return { ...raw, injuryWeeks: 0, retired: false }
}

/** Assign an AI GM strategy from roster quality/age. */
function inferStrategy(roster: Player[]): 'contend' | 'retool' | 'rebuild' {
  const sorted = [...roster].sort((a, b) => b.overall - a.overall)
  const top10 = avg(sorted.slice(0, 10).map((p) => p.overall), 78)
  const meanAge = avg(roster.map((p) => p.age), 27)
  if (top10 >= 84) return 'contend'
  if (top10 <= 78.5 || meanAge <= 25.5) return 'rebuild'
  return 'retool'
}

/** Natural draft picks (2 rounds) for every upcoming draft in the dynasty. */
function initialPicks(abbrev: string): DraftPick[] {
  const picks: DraftPick[] = []
  // Drafts run in the offseason after each season: years START_YEAR+1 .. +SEASONS_TOTAL.
  for (let y = START_YEAR + 1; y <= START_YEAR + SEASONS_TOTAL; y++) {
    picks.push({ year: y, round: 1, originalTeam: abbrev, owner: abbrev })
    picks.push({ year: y, round: 2, originalTeam: abbrev, owner: abbrev })
  }
  return picks
}

export function newGame(userTeam: string, data: TeamDataFile[]): GameState {
  const teams: Record<string, TeamState> = {}
  for (const file of data) {
    const abbrev = file.info.abbrev
    const roster = file.roster.map(hydratePlayer)
    const prospects = file.prospects.map(hydratePlayer)
    teams[abbrev] = {
      ...file.info,
      roster,
      prospects,
      picks: initialPicks(abbrev),
      strategy: inferStrategy(roster),
    }
  }
  if (!teams[userTeam]) {
    const first = Object.keys(teams)[0]
    userTeam = first
  }

  const rng = new Rng(seedFrom(userTeam + ':' + START_YEAR))
  const s: GameState = {
    v: 1,
    seasonYear: START_YEAR,
    seasonIndex: 0,
    phase: 'regular',
    userTeam,
    teams,
    schedule: [],
    day: 0,
    stats: {},
    freeAgents: [],
    draftClass: [],
    history: [],
    news: [{ day: 0, seasonYear: START_YEAR, text: `Welcome to your dynasty with the ${teams[userTeam].city} ${teams[userTeam].name}. The ${START_YEAR}-${String((START_YEAR + 1) % 100).padStart(2, '0')} season begins.` }],
    rngState: rng.state,
    careers: {},
  }
  s.schedule = buildSchedule(teams, rng)
  s.rngState = rng.state
  return s
}

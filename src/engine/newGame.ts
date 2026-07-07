// New-game setup: builds the full 32-team league from team data and generates
// the first season's schedule.
import type { GameState, TeamState, Player, DraftPick, TeamDataFile, FreeAgent, FreeAgentPoolFile, DraftClassFile } from '../types.ts'
import { START_YEAR, SEASONS_TOTAL } from '../types.ts'
import { Rng, seedFrom } from './rng.ts'
import { buildSchedule } from './schedule.ts'
import { avg, nextCap, ext } from './helpers.ts'
import { toFreeAgent } from './freeAgency.ts'

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

/** Natural draft picks (3 rounds) for every upcoming draft in the dynasty. */
function initialPicks(abbrev: string): DraftPick[] {
  const picks: DraftPick[] = []
  // Drafts run in the offseason after each season: years START_YEAR+1 .. +SEASONS_TOTAL.
  for (let y = START_YEAR + 1; y <= START_YEAR + SEASONS_TOTAL; y++) {
    picks.push({ year: y, round: 1, originalTeam: abbrev, owner: abbrev })
    picks.push({ year: y, round: 2, originalTeam: abbrev, owner: abbrev })
    picks.push({ year: y, round: 3, originalTeam: abbrev, owner: abbrev })
  }
  return picks
}

export function newGame(userTeam: string, data: TeamDataFile[], faPool?: FreeAgentPoolFile, draft2027?: DraftClassFile): GameState {
  const teams: Record<string, TeamState> = {}
  // Real past-season stats bundled with the data snapshot seed the career archive.
  const careers: GameState['careers'] = {}
  const absorbHistory = (p: Player): Player => {
    if (p.history && p.history.length > 0) {
      careers[p.id] = [...p.history].sort((a, b) => a.year - b.year)
    }
    const { history, ...rest } = p
    return rest
  }
  for (const file of data) {
    const abbrev = file.info.abbrev
    const roster = file.roster.map(hydratePlayer).map(absorbHistory)
    const prospects = file.prospects.map(hydratePlayer).map(absorbHistory)
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

  // Seed the real leftover UFAs into the free-agent pool. They are signable at
  // the first offseason's free agency (alongside players who walk); the empty
  // pool (data still being authored) simply yields no seeded FAs.
  const faCap = nextCap(START_YEAR) // cap governing the first free-agency window
  const seededFreeAgents: FreeAgent[] = []
  for (const raw of faPool?.players ?? []) {
    const p = absorbHistory(hydratePlayer(raw))
    p.contract = null // pool players are unsigned; engine computes asking
    seededFreeAgents.push(toFreeAgent(p, faCap))
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
    freeAgents: seededFreeAgents,
    draftClass: [],
    history: [],
    news: [{ day: 0, seasonYear: START_YEAR, text: `Welcome to your dynasty with the ${teams[userTeam].city} ${teams[userTeam].name}. The ${START_YEAR}-${String((START_YEAR + 1) % 100).padStart(2, '0')} season begins.` }],
    rngState: rng.state,
    careers,
    tradeBlock: [],
    pendingOffers: [],
  }
  // Thread the real projected 2027 draft class onto private state; the first
  // in-game entry draft (June 2027) seeds from it. Empty/absent => fully generated.
  if (draft2027 && draft2027.players.length > 0) ext(s)._draft2027 = draft2027
  s.schedule = buildSchedule(teams, rng)
  s.rngState = rng.state
  return s
}

/** Dynasty FANTASY draft mode: build the league exactly as `newGame`, then pull
 *  EVERY team's NHL roster players (keeping their real contracts) into a single
 *  draft pool and start a 23-round snake draft. Prospects, draft picks and the FA
 *  pool stay attached to their original clubs. The schedule is (re)built when the
 *  draft completes (see fantasy.ts), so it is cleared here. */
export function newGameFantasyCore(userTeam: string, data: TeamDataFile[], faPool?: FreeAgentPoolFile, draft2027?: DraftClassFile): GameState {
  const s = newGame(userTeam, data, faPool, draft2027)
  const pool: Player[] = []
  for (const abbr of Object.keys(s.teams)) {
    const team = s.teams[abbr]
    for (const p of team.roster) pool.push(p)
    team.roster = []
  }
  // Roughly best-first so an auto/AI board reads sensibly.
  pool.sort((a, b) => b.overall - a.overall)
  const rng = new Rng(s.rngState)
  const order = rng.shuffle(Object.keys(s.teams).slice())
  s.rngState = rng.state
  s.schedule = [] // rebuilt at draft completion
  s.mode = 'fantasy'
  s.phase = 'fantasyDraft'
  s.fantasyDraft = { order, pickIndex: 0, pool, rounds: 23 }
  s.news = [{ day: 0, seasonYear: s.seasonYear, text: `Fantasy draft: every NHL player is available. Build your ${s.teams[userTeam].city} ${s.teams[userTeam].name} from scratch.` }]
  return s
}

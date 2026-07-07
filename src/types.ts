// ============================================================
// Hockey Dynasty — shared type contract
// All engine modules, UI components, and data files conform to
// these types. Do not change signatures without updating
// ARCHITECTURE.md and every consumer.
// ============================================================

export type Position = 'C' | 'LW' | 'RW' | 'D' | 'G'
export type Conference = 'East' | 'West'
export type Division = 'Atlantic' | 'Metropolitan' | 'Central' | 'Pacific'
export type ExpiryStatus = 'RFA' | 'UFA'

export interface Contract {
  /** Cap hit in millions of dollars, e.g. 13.25 */
  capHit: number
  /** Seasons remaining INCLUDING the current one. 1 = expires after this season. */
  yearsLeft: number
  /** Status when the contract expires */
  expiry: ExpiryStatus
  /** No-trade / no-move clause — AI won't accept trades sending this player without waiver */
  ntc?: boolean
}

export interface Player {
  id: string
  name: string
  pos: Position
  /** Age in years as of Oct 1 of the CURRENT in-game season (mutated each offseason) */
  age: number
  shoots: 'L' | 'R'
  /** EA-style 25..99 current ability */
  overall: number
  /** EA-style ceiling; >= overall for young players, == overall for 27+ */
  potential: number
  /** null for unsigned draft prospects */
  contract: Contract | null
  /** Country code for flavor, e.g. 'CAN', 'USA', 'SWE' */
  nationality?: string
  /** Weeks remaining out injured; 0/undefined = healthy */
  injuryWeeks?: number
  /** True once the player has retired (kept for history) */
  retired?: boolean
  /** Development league for prospects, e.g. 'NCAA', 'CHL', 'AHL', 'SHL', 'Liiga', 'KHL', 'Czechia' */
  devLeague?: string
  /** Real past NHL seasons bundled with the data snapshot (newGame moves these into GameState.careers) */
  history?: CareerSeason[]
}

export interface SeasonStatLine {
  playerId: string
  gp: number
  goals: number
  assists: number
  points: number
  plusMinus: number
  pim: number
  // goalies
  wins?: number
  losses?: number
  otl?: number
  shutouts?: number
  gaa?: number
  svPct?: number
}

export interface DraftPick {
  /** Draft year, e.g. 2026 */
  year: number
  round: number // 1..7
  /** Abbrev of the team whose finish determines the slot */
  originalTeam: string
  /** Abbrev of the team that currently owns the pick */
  owner: string
}

export interface TeamInfo {
  abbrev: string // 'TOR'
  city: string // 'Toronto'
  name: string // 'Maple Leafs'
  conference: Conference
  division: Division
  /** Primary hex color for UI, e.g. '#00205B' */
  color: string
  colorSecondary?: string
}

export interface TeamState extends TeamInfo {
  /** Signed players on the NHL roster */
  roster: Player[]
  /** Drafted/signed young players not on the NHL roster */
  prospects: Player[]
  picks: DraftPick[]
  /** GM behavior profile for AI teams */
  strategy: 'contend' | 'retool' | 'rebuild'
}

/** One goal in a game's box score, in scoring order. */
export interface GoalEvent {
  /** Abbrev of the scoring team */
  team: string
  scorerId: string
  /** 0-2 assist player ids */
  assistIds: string[]
  /** Period scored in: 1-3, 4 = OT (absent on legacy saves) */
  period?: 1 | 2 | 3 | 4
}

export interface Game {
  id: number
  /** 0-based day index within the season calendar */
  day: number
  home: string
  away: string
  played: boolean
  homeGoals?: number
  awayGoals?: number
  /** 'REG' | 'OT' | 'SO' */
  endType?: 'REG' | 'OT' | 'SO'
  /** Box score: every goal with scorer + assists (current season only; cleared at rollover) */
  goals?: GoalEvent[]
}

export interface StandingsRow {
  team: string
  gp: number
  w: number
  l: number
  otl: number
  pts: number
  gf: number
  ga: number
}

export type Phase =
  | 'fantasyDraft' // optional pre-season fantasy draft (dynasty draft mode)
  | 'regular' // day-by-day sim of the 82-game season
  | 'playoffs' // 16-team bracket, best-of-7
  | 'offseason' // retirement, development, re-sign own expiring, draft, free agency
  | 'over' // 10 seasons complete

/** One completed playoff game within a series. */
export interface PlayoffGame {
  /** Abbrev of the home team for this game */
  home: string
  homeGoals: number
  awayGoals: number
  endType: 'REG' | 'OT'
  /** Box score (scorer/assists/period), same shape as regular-season games */
  goals?: GoalEvent[]
}

export interface PlayoffSeries {
  round: number // 1..4
  high: string // higher seed abbrev
  low: string
  highWins: number
  lowWins: number
  winner?: string
  /** Game-by-game results, in order played (absent on legacy saves) */
  games?: PlayoffGame[]
}

export interface SeasonSummary {
  /** Start year, e.g. 2026 for the 2026-27 season */
  year: number
  presidentsTrophy: string
  cupWinner: string
  cupRunnerUp: string
  userFinish: string // human-readable, e.g. "Lost in Round 2", "Missed playoffs (5th in Atlantic)"
  awards: { name: string; playerId: string; playerName: string; team: string }[]
  /** Top-10 scorers that season for the history screen */
  topScorers: { playerName: string; team: string; points: number; goals: number }[]
  userRecord: { w: number; l: number; otl: number; pts: number }
}

export interface FreeAgent extends Player {
  /** What the player wants: capHit ($M) and years. UI shows this; signing at/above it succeeds. */
  asking: { capHit: number; years: number }
  /** RFA whose rights belong to this team — signing requires an offer sheet (match + pick compensation). */
  rightsTeam?: string
}

/** An offer sheet tendered to one of the USER's restricted free agents by an AI team. */
export interface PendingOfferSheet {
  id: number
  playerId: string
  /** AI team tendering the sheet */
  from: string
  years: number
  capHit: number
  /** FA day it arrived (user must match or decline before FA ends) */
  day: number
}

/** User-set line assignments (player ids). Slots may be empty/invalid — the
 *  engine falls back to auto-selection per slot. */
export interface LineAssignments {
  /** 4 forward lines x [LW, C, RW] */
  forwards: string[][]
  /** 3 defense pairs x [LD, RD] */
  defense: string[][]
  /** [starter, backup] */
  goalies: string[]
}

/** A trade proposal between two teams. `from` pays fromPlayers/fromPicks, receives toPlayers/toPicks. */
export interface TradeOffer {
  from: string
  to: string
  fromPlayers: string[]
  toPlayers: string[]
  fromPicks: DraftPick[]
  toPicks: DraftPick[]
}

/** An AI-initiated trade offer awaiting the user's response. */
export interface PendingOffer {
  id: number
  /** Offer expressed from the USER's perspective (offer.from === userTeam). */
  offer: TradeOffer
  /** Day/season it arrived (for display + expiry). */
  day: number
  seasonYear: number
}

/** One archived season line for a player's career history. */
export interface CareerSeason {
  year: number
  /** Team abbrev the player finished the season with */
  team: string
  gp: number
  goals: number
  assists: number
  points: number
  plusMinus: number
  pim: number
  // goalies
  wins?: number
  losses?: number
  otl?: number
  shutouts?: number
  gaa?: number
  svPct?: number
}

export interface GameState {
  /** Save-format version for migrations */
  v: number
  /** Start year of current season: 2026 => 2026-27 */
  seasonYear: number
  /** Index 0..9 of the dynasty (10 seasons) */
  seasonIndex: number
  phase: Phase
  /** Sub-step within the offseason, in order */
  offseasonStep?: 'awards' | 'development' | 'resign' | 'draft' | 'freeAgency' | 'rosterCheck'
  userTeam: string
  teams: Record<string, TeamState>
  schedule: Game[]
  /** Current day pointer into the schedule calendar (0..~185) */
  day: number
  /** Season player stats, keyed by playerId */
  stats: Record<string, SeasonStatLine>
  playoffs?: PlayoffSeries[]
  freeAgents: FreeAgent[]
  /** Current draft class (offseason only) */
  draftClass: Player[]
  /** Draft order of team abbrevs (offseason only), index 0 = 1st overall slot owner-original */
  draftOrder?: string[]
  history: SeasonSummary[]
  /** Message log shown in the UI (trades, signings, injuries, milestones) */
  news: { day: number; seasonYear: number; text: string }[]
  /** Seeded RNG state so saves are deterministic */
  rngState: number
  /** Career stat archive keyed by playerId; appended at each season's end */
  careers: Record<string, CareerSeason[]>
  /** Player ids (user's team) shopped on the trade block */
  tradeBlock: string[]
  /** AI-initiated trade offers awaiting user response */
  pendingOffers: PendingOffer[]
  /** Manual line assignments for the user's team; absent = full auto */
  userLines?: LineAssignments
  /** Offer sheets tendered to the user's RFAs, awaiting match/decline */
  pendingSheets?: PendingOfferSheet[]
  /** Permanent id -> name registry so departed/retired players stay resolvable */
  names?: Record<string, string>
  /** Playoff stat lines, kept separate from the 82-game season (keyed by playerId) */
  playoffStats?: Record<string, SeasonStatLine>
  /** 'fantasy' = rosters were built via the dynasty fantasy draft */
  mode?: 'standard' | 'fantasy'
  /** Transient fantasy-draft state (phase === 'fantasyDraft' only) */
  fantasyDraft?: {
    /** Snake-draft team order for round 1 (reverses each round) */
    order: string[]
    /** 0-based overall pick pointer */
    pickIndex: number
    /** Undrafted player pool, roughly best-first */
    pool: Player[]
    /** Total rounds (each team drafts this many players) */
    rounds: number
  }
}

/** Salary cap in $M by season start year. */
export const SALARY_CAP: Record<number, number> = {
  2025: 95.5,
  2026: 104,
  2027: 113.5,
  2028: 119.5,
  2029: 125.5,
  2030: 131.8,
  2031: 138.4,
  2032: 145.3,
  2033: 152.6,
  2034: 160.2,
  2035: 168.2,
}

export const ROSTER_MIN = 20
export const ROSTER_MAX = 23
export const SEASONS_TOTAL = 10
export const START_YEAR = 2026

/** Raw shape of the bundled team data files (data/teams/*.json) */
export interface TeamDataFile {
  info: TeamInfo
  roster: Omit<Player, 'injuryWeeks' | 'retired'>[]
  prospects: Omit<Player, 'injuryWeeks' | 'retired'>[]
}

/** Raw shape of data/draft-2027.json — the real projected 2027 draft class used
 *  for the FIRST in-game entry draft; later drafts generate fictional classes. */
export interface DraftClassFile {
  year: number
  players: Omit<Player, 'injuryWeeks' | 'retired'>[]
}

/** Raw shape of data/free-agents.json — real unsigned UFAs as of the snapshot date.
 *  contract is null; the engine computes each player's asking price. */
export interface FreeAgentPoolFile {
  players: Omit<Player, 'injuryWeeks' | 'retired'>[]
}

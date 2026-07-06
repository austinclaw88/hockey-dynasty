// Headless 10-season smoke test for the engine (ARCHITECTURE.md "Testing").
// Run: node --experimental-strip-types scripts/sim-test.ts
//
// Imports the REAL engine. Loads data/teams/*.json directly with fs when all 32
// files are present; otherwise falls back to a generated synthetic 32-team
// league so the engine can be exercised before the data files land.
// Node builtins are declared in ./node-shims.d.ts so this script type-checks
// without @types/node installed. It is executed via `node
// --experimental-strip-types`, which ignores types entirely.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { TeamDataFile, GameState, Player, Position } from '../src/types.ts'
import { newGame } from '../src/engine/newGame.ts'
import {
  simDays,
  simToEndOfSeason,
  simPlayoffRound,
  advanceOffseason,
  getStandings,
  getLeaders,
  getCapUsage,
  getResignAsking,
  resignPlayer,
  getDraftBoard,
  draftPlayer,
  toggleTradeBlock,
  respondToOffer,
} from '../src/engine/api.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DIVS: Record<string, string[]> = {
  Atlantic: ['BOS', 'BUF', 'DET', 'FLA', 'MTL', 'OTT', 'TBL', 'TOR'],
  Metropolitan: ['CAR', 'CBJ', 'NJD', 'NYI', 'NYR', 'PHI', 'PIT', 'WSH'],
  Central: ['CHI', 'COL', 'DAL', 'MIN', 'NSH', 'STL', 'UTA', 'WPG'],
  Pacific: ['ANA', 'CGY', 'EDM', 'LAK', 'SJS', 'SEA', 'VAN', 'VGK'],
}
const ALL_TEAMS = Object.values(DIVS).flat()

// ---- data loading ---------------------------------------------------------
function loadRealData(): TeamDataFile[] | null {
  if (process.env.SIMTEST_SYNTH === '1') return null // force synthetic
  const dir = join(__dirname, '..', 'data', 'teams')
  if (!ALL_TEAMS.every((t) => existsSync(join(dir, `${t}.json`)))) return null
  try {
    return ALL_TEAMS.map((t) => JSON.parse(readFileSync(join(dir, `${t}.json`), 'utf8')) as TeamDataFile)
  } catch (e) {
    console.warn('Failed to parse real data, using synthetic:', (e as Error).message)
    return null
  }
}

// ---- synthetic fallback ---------------------------------------------------
let synSeed = 12345
function rnd(): number {
  synSeed = (synSeed * 1103515245 + 12345) & 0x7fffffff
  return synSeed / 0x7fffffff
}
function ri(min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1))
}
function synthTeam(abbrev: string, conf: string, div: string): TeamDataFile {
  const roster: Omit<Player, 'injuryWeeks' | 'retired'>[] = []
  const mk = (pos: Position, i: number, ovMin: number, ovMax: number): void => {
    const overall = ri(ovMin, ovMax)
    const age = ri(20, 35)
    roster.push({
      id: `${abbrev}-${pos}${i}`,
      name: `${abbrev} ${pos}${i}`,
      pos,
      age,
      shoots: rnd() < 0.6 ? 'L' : 'R',
      overall,
      potential: age < 25 ? Math.min(99, overall + ri(2, 10)) : overall,
      nationality: 'CAN',
      contract: { capHit: Math.max(0.775, Math.round((overall - 68) * 0.35 * 100) / 100), yearsLeft: ri(1, 5), expiry: age < 27 ? 'RFA' : 'UFA' },
    })
  }
  const fPos: Position[] = ['C', 'LW', 'RW']
  for (let i = 0; i < 14; i++) mk(fPos[i % 3], i, i < 3 ? 84 : i < 9 ? 78 : 72, i < 3 ? 92 : i < 9 ? 84 : 78)
  for (let i = 0; i < 7; i++) mk('D', i, i < 2 ? 82 : 74, i < 2 ? 89 : 80)
  for (let i = 0; i < 2; i++) mk('G', i, i < 1 ? 82 : 76, i < 1 ? 90 : 80)
  const prospects: Omit<Player, 'injuryWeeks' | 'retired'>[] = []
  for (let i = 0; i < 4; i++) {
    const overall = ri(58, 68)
    prospects.push({
      id: `${abbrev}-P${i}`,
      name: `${abbrev} Prospect${i}`,
      pos: (['C', 'D', 'LW', 'G'] as Position[])[i],
      age: 19,
      shoots: 'L',
      overall,
      potential: overall + ri(8, 24),
      nationality: 'CAN',
      contract: { capHit: 0.9, yearsLeft: 3, expiry: 'RFA' },
    })
  }
  return {
    info: { abbrev, city: abbrev, name: `${abbrev} Club`, conference: conf as 'East' | 'West', division: div as 'Atlantic', color: '#204080' },
    roster,
    prospects,
  }
}
function syntheticData(): TeamDataFile[] {
  const out: TeamDataFile[] = []
  for (const [div, teams] of Object.entries(DIVS)) {
    const conf = div === 'Atlantic' || div === 'Metropolitan' ? 'East' : 'West'
    for (const t of teams) out.push(synthTeam(t, conf, div))
  }
  return out
}

// ---- assertions -----------------------------------------------------------
let failures = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures++
    console.error('  ASSERT FAILED:', msg)
  }
}
function isNum(x: number | undefined): boolean {
  return x !== undefined && typeof x === 'number' && !Number.isNaN(x)
}

// ---- new-systems assertions -----------------------------------------------
function onTeam(s: GameState, abbr: string, id: string): boolean {
  const t = s.teams[abbr]
  return !!t && (t.roster.some((p) => p.id === id) || t.prospects.some((p) => p.id === id))
}
/** Every pending offer must reference resolvable assets on the expected rosters. */
function assertOffersResolvable(s: GameState, when: string): void {
  for (const po of s.pendingOffers) {
    assert(po.offer.from === s.userTeam, `pending offer ${po.id} not from user team (${when})`)
    const fromOk = po.offer.fromPlayers.every((id) => onTeam(s, po.offer.from, id))
    const toOk = po.offer.toPlayers.every((id) => onTeam(s, po.offer.to, id))
    assert(fromOk && toOk, `pending offer ${po.id} references a departed player (${when})`)
  }
}
/** Stars must not be let go to free agency by the AI re-sign pass. */
function assertNoStarFreeAgents(s: GameState, when: string): void {
  for (const fa of s.freeAgents) {
    assert(fa.overall < 88, `${fa.name} (${fa.overall} OVR) reached the FA pool (${when})`)
  }
}

// ---- offseason auto-driver ------------------------------------------------
function runOffseason(s: GameState, checkNoStarFA: boolean): GameState {
  let guard = 0
  while (s.phase === 'offseason' && guard++ < 20) {
    const step = s.offseasonStep
    // In the first 3 offseasons no >=88 OVR player may be dumped to free agency.
    if (checkNoStarFA) assertNoStarFreeAgents(s, `offseason step ${step ?? '?'}`)
    assertOffersResolvable(s, `offseason step ${step ?? '?'}`)
    if (step === 'resign') {
      // Re-sign every expiring player at their asking price.
      const expiring = s.teams[s.userTeam].roster.filter((p) => p.contract && p.contract.yearsLeft <= 0).map((p) => p.id)
      for (const id of expiring) {
        const ask = getResignAsking(s, id)
        const r = resignPlayer(s, id, ask.years, ask.capHit)
        if (r.ok) s = r.s
      }
    } else if (step === 'draft') {
      // Make user picks: best available by potential.
      let board = getDraftBoard(s)
      let picks = 0
      while (board.onClock === s.userTeam && board.available.length > 0 && picks++ < 30) {
        const best = [...board.available].sort((a, b) => b.potential - a.potential || b.overall - a.overall)[0]
        s = draftPlayer(s, best.id)
        board = getDraftBoard(s)
      }
    }
    s = advanceOffseason(s)
  }
  return s
}

// ---- main -----------------------------------------------------------------
function fmtRec(r: { w: number; l: number; otl: number; pts: number }): string {
  return `${r.w}-${r.l}-${r.otl} (${r.pts})`
}

function main(): void {
  const real = loadRealData()
  const data = real ?? syntheticData()
  console.log(`Data source: ${real ? 'REAL data/teams/*.json' : 'SYNTHETIC fallback'} (${data.length} teams)`)
  const userTeam = data.some((d) => d.info.abbrev === 'TOR') ? 'TOR' : data[0].info.abbrev
  console.log(`User team: ${userTeam}\n`)

  const t0 = Date.now()
  let s = newGame(userTeam, data)
  const rows: string[] = []

  for (let season = 0; season < 10; season++) {
    const seasonYear = s.seasonYear
    // Exercise the trade block + incoming offers: shop a mid-tier user player.
    const shopId = pickShoppable(s)
    if (shopId) s = toggleTradeBlock(s, shopId)

    const simStart = Date.now()
    // Sim the pre-deadline stretch in weekly chunks so incoming offers can
    // generate; respond to some and confirm they always reference live assets.
    let wk = 0
    while (s.phase === 'regular' && s.day < 84 && wk++ < 15) {
      s = simDays(s, 7)
      assertOffersResolvable(s, `${seasonYear} day ${s.day}`)
      if (s.pendingOffers.length > 0) {
        const po = s.pendingOffers[0]
        const r = respondToOffer(s, po.id, wk % 2 === 0)
        if (r.ok) s = r.s
        assertOffersResolvable(s, `${seasonYear} post-respond`)
      }
    }
    if (s.phase === 'regular') s = simToEndOfSeason(s)
    const simMs = Date.now() - simStart

    // Regular-season assertions.
    const standings = getStandings(s)
    for (const row of standings.league) {
      assert(row.gp === 82, `${row.team} played ${row.gp} GP (expected 82) in ${seasonYear}`)
      assert(row.pts >= 30 && row.pts <= 145, `${row.team} has ${row.pts} pts (expect 30-145) in ${seasonYear}`)
    }
    assert(s.phase === 'playoffs', `phase should be playoffs after regular season (${seasonYear})`)

    // Scoring leader sanity + NaN scan.
    const leaders = getLeaders(s)
    const leaderPts = leaders.points[0]?.points ?? 0
    // Upper bound is generous: late-dynasty leaders climb as young stars develop
    // toward 99 OVR, and elite scorers now stay in the league (AI no longer lets
    // 85+ players walk to the FA void) rather than disappearing mid-prime.
    assert(leaderPts >= 70 && leaderPts <= 180, `scoring leader has ${leaderPts} pts (expect 70-180) in ${seasonYear}`)
    for (const line of Object.values(s.stats)) {
      const ok = isNum(line.goals) && isNum(line.assists) && isNum(line.points) && isNum(line.plusMinus) && isNum(line.pim) && isNum(line.gp)
      assert(ok, `NaN in skater stat line ${line.playerId} (${seasonYear})`)
      if (line.gaa !== undefined) assert(isNum(line.gaa) && isNum(line.svPct), `NaN in goalie stats ${line.playerId} (${seasonYear})`)
    }

    // Playoffs.
    let pguard = 0
    while (s.phase === 'playoffs' && pguard++ < 6) s = simPlayoffRound(s)
    assert(s.phase === 'offseason', `phase should be offseason after playoffs (${seasonYear})`)

    const summary = s.history[s.history.length - 1]
    assert(!!summary && !!summary.cupWinner, `a Cup winner should exist for ${seasonYear}`)
    const leaderName = leaders.points[0] ? nameOf(s, leaders.points[0].playerId) : '?'

    // Offseason (first 3 offseasons: assert no >=88 OVR player hits free agency).
    s = runOffseason(s, season < 3)
    assertOffersResolvable(s, `${seasonYear} post-offseason`)

    // Post-offseason (new-season) roster + cap legality (each October).
    if (s.phase === 'regular') {
      for (const abbr of Object.keys(s.teams)) {
        const t = s.teams[abbr]
        const n = t.roster.length
        assert(n >= 20 && n <= 23, `${abbr} roster size ${n} at start of ${s.seasonYear} (expect 20-23)`)
        const nG = t.roster.filter((p) => p.pos === 'G').length
        const nD = t.roster.filter((p) => p.pos === 'D').length
        const nF = t.roster.filter((p) => p.pos !== 'G' && p.pos !== 'D').length
        assert(nG >= 2 && nD >= 6 && nF >= 12, `${abbr} illegal position counts F${nF}/D${nD}/G${nG} in ${s.seasonYear}`)
        const cap = getCapUsage(s, abbr)
        assert(cap.used <= cap.cap + 0.001, `${abbr} over cap: ${cap.used.toFixed(1)}/${cap.cap} in ${s.seasonYear}`)
      }
    }

    rows.push(
      [
        `${seasonYear}-${(seasonYear + 1) % 100}`.padEnd(8),
        summary.cupWinner.padEnd(5),
        summary.presidentsTrophy.padEnd(5),
        summary.userFinish.padEnd(26),
        fmtRec(summary.userRecord).padEnd(16),
        `${leaderName} ${leaderPts}`.padEnd(22),
        `${simMs}ms`,
      ].join(' '),
    )
  }

  const totalMs = Date.now() - t0
  console.log('Season   Cup   Pres  UserFinish                 UserRecord       ScoringLeader          SimTime')
  console.log('-'.repeat(110))
  for (const r of rows) console.log(r)
  console.log('-'.repeat(110))
  console.log(`\nPhase after 10 seasons: ${s.phase} (expect 'over')`)
  assert(s.phase === 'over', `dynasty should be over after 10 seasons (got ${s.phase})`)
  assert(s.history.length === 10, `history should have 10 seasons (got ${s.history.length})`)
  console.log(`Total time: ${totalMs}ms`)

  // Career-history archive assertions.
  const careerIds = Object.keys(s.careers)
  assert(careerIds.length > 0, 'careers should be non-empty after 10 seasons')
  const maxSeasons = careerIds.reduce((m, id) => Math.max(m, s.careers[id].length), 0)
  assert(maxSeasons >= 5, `some player should have 5+ archived seasons (max was ${maxSeasons})`)
  let careerNaN = false
  for (const id of careerIds) {
    for (const cs of s.careers[id]) {
      const ok =
        isNum(cs.year) && isNum(cs.gp) && isNum(cs.goals) && isNum(cs.assists) && isNum(cs.points) && isNum(cs.plusMinus) && isNum(cs.pim) &&
        (cs.wins === undefined || isNum(cs.wins)) && (cs.losses === undefined || isNum(cs.losses)) && (cs.otl === undefined || isNum(cs.otl)) &&
        (cs.shutouts === undefined || isNum(cs.shutouts)) && (cs.gaa === undefined || isNum(cs.gaa)) && (cs.svPct === undefined || isNum(cs.svPct))
      if (!ok) careerNaN = true
    }
  }
  assert(!careerNaN, 'no NaN should appear in any archived career line')

  if (failures === 0) console.log('\nALL ASSERTIONS PASSED ✔')
  else {
    console.error(`\n${failures} ASSERTION(S) FAILED ✘`)
    process.exit(1)
  }
}

/** A tradeable mid-tier user player to shop (or null if none). */
function pickShoppable(s: GameState): string | null {
  const roster = s.teams[s.userTeam].roster.filter((p) => !p.contract?.ntc && p.overall >= 76 && p.overall <= 84)
  return roster.length > 0 ? roster[0].id : null
}

function nameOf(s: GameState, id: string): string {
  for (const abbr of Object.keys(s.teams)) {
    const p = s.teams[abbr].roster.find((x) => x.id === id) ?? s.teams[abbr].prospects.find((x) => x.id === id)
    if (p) return p.name
  }
  return id
}

main()

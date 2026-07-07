#!/usr/bin/env node
// ============================================================================
// update-rosters.mjs — sync data/teams/*.json + data/free-agents.json with the
// current real NHL, using the NHL public API. Node builtins only, no deps.
//
// Runs LOCALLY (the authoring sandbox has no network). It is written defensively
// and is fully testable OFFLINE via `--fixtures` (see below).
//
// SOURCES (NHL public API):
//   roster:  https://api-web.nhle.com/v1/roster/{TEAM}/{SEASON}
//            -> { forwards[], defensemen[], goalies[] } each entry has
//               id, firstName.default, lastName.default, positionCode,
//               shootsCatches, birthDate, birthCountry
//   player:  https://api-web.nhle.com/v1/player/{playerId}/landing
//            -> featuredStats / last5Games / seasonTotals[]
//
// WHAT IT DOES (diff engine; players matched by normalized name across every
// team file + free-agents.json):
//   * MOVED    — dataset team A, API team B: the player's ENTIRE record
//                (contract, ratings, history) moves to B's file.
//   * NEW      — in the API, not the dataset: fresh entry; pos/shoots/age/
//                nationality from the API, `overall` DERIVED (formula below),
//                contract a league-min PLACEHOLDER flagged for review.
//   * DEPARTED — on a dataset roster, on no API roster: moved to free agency
//                (contract null), or reported likely-retired and removed if
//                age >= 36 and low overall. Never drops a team below 12F/6D/2G:
//                such a player is KEPT with `_flag:"verify-departure"`.
//   * HISTORY  — with --append-history, the just-completed real season line is
//                appended to every matched player's `history` (dedupe by year,
//                keep last 5).
// ALWAYS PRESERVED: existing players' contracts (the API has no salary data) and
// their overalls/potentials. `--retune` nudges an existing overall by at most
// +/-3 toward what the stats formula suggests.
//
// RATING FORMULA (documented approximation, hand-tune afterward):
//   skater:  ovr = 62 + (points/GP)*22
//            + TOI adj (avgToi >=19min +2, <13min -2 when present)
//            + age adj (<=23 +1, >=34 -1)
//            - 2 if GP < 40 (part season);  clamp 66..92
//   goalie:  ovr = 62 + (savePct - .880)*400  - 2 if GP < 20;  clamp 66..92
//   no stats (true rookie): 72
//   potential: == overall for age >= 27; else overall + clamp(round(6 +
//              (27-age)*0.9), 6, 14), capped at 99.
//   new contract placeholder: { capHit: 0.85, yearsLeft: 1,
//              expiry: age<27?'RFA':'UFA' }  (flagged review-contract)
//
// SAFETY: default is a DRY RUN — it prints a full change report and writes
// data/update-report.md but touches no team files. `--apply` writes the files,
// then runs validate-data.mjs; if the data comes out invalid it RESTORES the
// originals from an in-memory backup and reports what broke.
//
// USAGE
//   node scripts/update-rosters.mjs                     # dry-run, infer season
//   node scripts/update-rosters.mjs --apply             # write files
//   node scripts/update-rosters.mjs --season 20262027 --append-history --apply
//   node scripts/update-rosters.mjs --retune --apply    # also nudge overalls
//   node scripts/update-rosters.mjs --fixtures scripts/fixtures --apply
//                                                       # offline, from fixtures
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEAMS_DIR = join(__dirname, '..', 'data', 'teams')
const FA_FILE = join(__dirname, '..', 'data', 'free-agents.json')
const REPORT_FILE = join(__dirname, '..', 'data', 'update-report.md')
const VALIDATE = join(__dirname, 'validate-data.mjs')

const TEAMS = [
  'ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET', 'EDM', 'FLA',
  'LAK', 'MIN', 'MTL', 'NJD', 'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS',
  'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG', 'WSH',
]

const NAME_TO_ABBREV = {
  'Anaheim Ducks': 'ANA', 'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF',
  'Carolina Hurricanes': 'CAR', 'Columbus Blue Jackets': 'CBJ', 'Calgary Flames': 'CGY',
  'Chicago Blackhawks': 'CHI', 'Colorado Avalanche': 'COL', 'Dallas Stars': 'DAL',
  'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM', 'Florida Panthers': 'FLA',
  'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN', 'Montréal Canadiens': 'MTL',
  'Montreal Canadiens': 'MTL', 'New Jersey Devils': 'NJD', 'Nashville Predators': 'NSH',
  'New York Islanders': 'NYI', 'New York Rangers': 'NYR', 'Ottawa Senators': 'OTT',
  'Philadelphia Flyers': 'PHI', 'Pittsburgh Penguins': 'PIT', 'Seattle Kraken': 'SEA',
  'San Jose Sharks': 'SJS', 'St. Louis Blues': 'STL', 'Tampa Bay Lightning': 'TBL',
  'Toronto Maple Leafs': 'TOR', 'Utah Mammoth': 'UTA', 'Utah Hockey Club': 'UTA',
  'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK', 'Winnipeg Jets': 'WPG',
  'Washington Capitals': 'WSH', 'Arizona Coyotes': 'ARI',
}

// ---- args ------------------------------------------------------------------
const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const APPLY = has('--apply')
const APPEND_HISTORY = has('--append-history')
const RETUNE = has('--retune')
const FIXTURES = val('--fixtures')

function inferSeason() {
  const d = new Date()
  const y = d.getFullYear()
  const startYear = d.getMonth() >= 6 ? y : y - 1 // Jul(6)-Dec => current year
  return `${startYear}${startYear + 1}`
}
const SEASON = val('--season') || inferSeason()
const SEASON_START = parseInt(SEASON.slice(0, 4), 10) // e.g. 2026
const COMPLETED_YEAR = SEASON_START - 1               // just-finished season start year
const COMPLETED_SEASON = COMPLETED_YEAR * 10000 + (COMPLETED_YEAR + 1) // e.g. 20252026

// ---- small helpers ---------------------------------------------------------
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)
const norm = (s) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
const posFromCode = (c) => ({ L: 'LW', R: 'RW', C: 'C', D: 'D', G: 'G' }[c] || 'C')
const posToArray = (pos) => (pos === 'D' ? 'D' : pos === 'G' ? 'G' : 'F')

function ageAsOf(birthDate) {
  if (!birthDate) return 25
  const b = new Date(birthDate)
  const ref = new Date(Date.UTC(SEASON_START, 9, 1)) // Oct 1 of season start year
  let age = ref.getUTCFullYear() - b.getUTCFullYear()
  const m = ref.getUTCMonth() - b.getUTCMonth()
  if (m < 0 || (m === 0 && ref.getUTCDate() < b.getUTCDate())) age--
  return age
}

// Most recent NHL regular-season stat block from a landing (or null).
function latestNhlSeason(landing) {
  const rows = (landing?.seasonTotals ?? []).filter(
    (r) => r.leagueAbbrev === 'NHL' && r.gameTypeId === 2 && (r.gamesPlayed ?? 0) >= 1,
  )
  if (!rows.length) return null
  return rows.reduce((a, b) => ((b.season ?? 0) > (a.season ?? 0) ? b : a))
}

function skaterOverall(sub, age) {
  if (!sub || !(sub.gamesPlayed > 0)) return 72
  const ppg = (sub.points ?? 0) / sub.gamesPlayed
  let ovr = 62 + ppg * 22
  if (typeof sub.avgToi === 'string') {
    const min = parseInt(sub.avgToi.split(':')[0], 10)
    if (min >= 19) ovr += 2
    else if (min < 13) ovr -= 2
  }
  if (age <= 23) ovr += 1
  else if (age >= 34) ovr -= 1
  if (sub.gamesPlayed < 40) ovr -= 2
  return Math.round(clamp(ovr, 66, 92))
}
function goalieOverall(sub) {
  if (!sub || !(sub.gamesPlayed > 0)) return 72
  let ovr = 62 + ((sub.savePctg ?? 0.88) - 0.88) * 400
  if (sub.gamesPlayed < 20) ovr -= 2
  return Math.round(clamp(ovr, 66, 92))
}
function derivePotential(overall, age) {
  if (age >= 27) return overall
  return Math.min(99, overall + clamp(Math.round(6 + (27 - age) * 0.9), 6, 14))
}
function overallFrom(landing, pos, age) {
  const sub = latestNhlSeason(landing)
  return pos === 'G' ? goalieOverall(sub) : skaterOverall(sub, age)
}

// Build a CareerSeason line for the just-completed season, or null.
function completedSeasonLine(landing, pos, apiTeam) {
  if (COMPLETED_YEAR < 2005 || COMPLETED_YEAR > 2025) return null
  const row = (landing?.seasonTotals ?? []).find(
    (r) => r.season === COMPLETED_SEASON && r.leagueAbbrev === 'NHL' && r.gameTypeId === 2,
  )
  return row ? completedLineFromRow(row, pos, apiTeam) : null
}
function appendHistory(player, line) {
  if (!line || !(line.gp >= 1) || !/^[A-Z]{2,4}$/.test(line.team)) return false
  const hist = (player.history ?? []).filter((h) => h.year !== line.year)
  hist.push(line)
  hist.sort((x, y) => x.year - y.year)
  player.history = hist.slice(-5)
  return true
}

// ---- I/O (real fetch or fixture files) -------------------------------------
async function getRoster(team) {
  if (FIXTURES) {
    const f = join(FIXTURES, `${team}.json`)
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
  }
  const res = await fetch(`https://api-web.nhle.com/v1/roster/${team}/${SEASON}`,
    { headers: { 'User-Agent': 'hockey-dynasty/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} roster ${team}`)
  return res.json()
}
async function getLanding(id) {
  if (FIXTURES) {
    const f = join(FIXTURES, `player-${id}.json`)
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
  }
  const res = await fetch(`https://api-web.nhle.com/v1/player/${id}/landing`,
    { headers: { 'User-Agent': 'hockey-dynasty/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} landing ${id}`)
  return res.json()
}

// ---- main ------------------------------------------------------------------
async function main() {
  if (!FIXTURES && typeof fetch !== 'function') {
    console.error('Needs Node 18+ (global fetch), or use --fixtures.'); process.exit(1)
  }

  // Load every dataset file (needed for league-wide name matching), keep originals.
  const store = {}   // abbrev -> team file object (cloned/mutable)
  const original = {} // path -> original text (for restore)
  for (const t of TEAMS) {
    const p = join(TEAMS_DIR, `${t}.json`)
    original[p] = readFileSync(p, 'utf8')
    store[t] = JSON.parse(original[p])
  }
  original[FA_FILE] = readFileSync(FA_FILE, 'utf8')
  const fa = JSON.parse(original[FA_FILE])

  // Which teams do we have API truth for?
  const apiTeams = FIXTURES ? TEAMS.filter((t) => existsSync(join(FIXTURES, `${t}.json`))) : TEAMS
  if (!apiTeams.length) { console.error('No teams to process (no fixtures found).'); process.exit(1) }

  // Dataset index by normalized name -> {loc, kind, arr, player}
  const index = new Map()
  const addToIndex = (loc, kind, arr) => {
    for (const player of arr) {
      const n = norm(player.name)
      if (!index.has(n)) index.set(n, { loc, kind, arr, player })
    }
  }
  for (const t of TEAMS) { addToIndex(t, 'roster', store[t].roster); addToIndex(t, 'prospect', store[t].prospects) }
  addToIndex('FA', 'fa', fa.players)

  // Gather API players.
  const apiPlayers = [] // {team, apiId, pos, name, norm, shoots, birthDate, country}
  for (const t of apiTeams) {
    const r = await getRoster(t)
    if (!r) continue
    for (const [grp, arr] of [['F', r.forwards], ['D', r.defensemen], ['G', r.goalies]]) {
      for (const e of arr ?? []) {
        const name = `${e.firstName?.default ?? ''} ${e.lastName?.default ?? ''}`.trim()
        apiPlayers.push({
          team: t, apiId: e.id, pos: posFromCode(e.positionCode), name, norm: norm(name),
          shoots: e.shootsCatches ?? 'L', birthDate: e.birthDate, country: e.birthCountry, grp,
        })
      }
    }
  }

  const changedTeams = new Set()
  let faChanged = false
  const report = { moves: [], adds: [], departures: [], retired: [], kept: [], history: [], retunes: [], flagged: [] }
  const matched = new Set()   // normalized names matched by some API player
  const matchedRecords = []   // {player, ap} for existing players (history/retune)

  // ---- pass 1: API-driven (moves + adds) ----
  for (const ap of apiPlayers) {
    const ds = index.get(ap.norm)
    matched.add(ap.norm) // every API player is "present"; never treat as departed
    if (!ds) {
      // NEW to the dataset — create an entry from the API + derived rating.
      const landing = await getLanding(ap.apiId).catch(() => null)
      const age = ageAsOf(ap.birthDate)
      const overall = overallFrom(landing, ap.pos, age)
      const usedIds = new Set(Object.values(store).flatMap((s) => [...s.roster, ...s.prospects]).map((p) => p.id).concat(fa.players.map((p) => p.id)))
      let id = `${ap.team}-${norm(ap.name).split(' ').pop().replace(/[^a-z0-9]/g, '')}`
      let base = id, k = 2
      while (usedIds.has(id)) id = `${base}${k++}`
      const player = {
        id, name: ap.name, pos: ap.pos, age, shoots: ap.shoots, overall,
        potential: derivePotential(overall, age),
        contract: { capHit: 0.85, yearsLeft: 1, expiry: age < 27 ? 'RFA' : 'UFA' },
        nationality: ap.country || 'CAN', _flag: 'review-contract',
      }
      // New players get history built from their real NHL seasons (year <= 2025).
      const hist = (landing?.seasonTotals ?? [])
        .filter((r) => r.leagueAbbrev === 'NHL' && r.gameTypeId === 2 && (r.gamesPlayed ?? 0) >= 1)
        .map((r) => completedLineFromRow(r, ap.pos, ap.team))
        .filter((h) => h && h.year >= 2005 && h.year <= 2025)
      if (hist.length) { hist.sort((a, b) => a.year - b.year); player.history = hist.slice(-5) }
      store[ap.team].roster.push(player)
      changedTeams.add(ap.team)
      report.adds.push({ team: ap.team, name: ap.name, pos: ap.pos, overall, potential: player.potential, id })
      report.flagged.push({ team: ap.team, name: ap.name, contract: player.contract })
      continue
    }
    if (ds.kind === 'roster' && ds.loc === ap.team) {
      matchedRecords.push({ player: ds.player, ap })
      continue // stays put
    }
    // MOVED (cross-team, or promotion from prospects / signing from FA) -> B's roster.
    const i = ds.arr.indexOf(ds.player)
    if (i >= 0) ds.arr.splice(i, 1)
    store[ap.team].roster.push(ds.player)
    if (ds.loc === 'FA') faChanged = true; else changedTeams.add(ds.loc)
    changedTeams.add(ap.team)
    // re-point index so departure pass & later lookups see the new home
    index.set(ap.norm, { loc: ap.team, kind: 'roster', arr: store[ap.team].roster, player: ds.player })
    matchedRecords.push({ player: ds.player, ap })
    report.moves.push({ name: ds.player.name, from: ds.loc, to: ap.team, kind: ds.kind })
  }

  // ---- pass 2: departures (dataset roster players missing from API) ----
  for (const t of apiTeams) {
    const roster = store[t].roster
    for (const player of [...roster]) {
      if (matched.has(norm(player.name))) continue // present in some API roster
      const idx = roster.indexOf(player)
      if (idx < 0) continue
      // Would removing him break 12F/6D/2G? If so, keep with a flag.
      const c = { F: 0, D: 0, G: 0 }
      for (const p of roster) c[posToArray(p.pos)]++
      c[posToArray(player.pos)]--
      if (c.F < 12 || c.D < 6 || c.G < 2) {
        player._flag = 'verify-departure'
        changedTeams.add(t)
        report.kept.push({ team: t, name: player.name, reason: `keeps team legal (${c.F}F/${c.D}D/${c.G}G)` })
        continue
      }
      roster.splice(idx, 1)
      changedTeams.add(t)
      if (player.age >= 36 && player.overall < 78) {
        report.retired.push({ team: t, name: player.name, age: player.age, overall: player.overall })
      } else {
        const { _flag, ...rest } = player
        fa.players.push({ ...rest, contract: null })
        faChanged = true
        report.departures.push({ team: t, name: player.name, to: 'FA' })
      }
    }
  }

  // ---- pass 3: history append / retune for existing matched players ----
  if (APPEND_HISTORY || RETUNE) {
    for (const { player, ap } of matchedRecords) {
      const landing = await getLanding(ap.apiId).catch(() => null)
      if (!landing) continue
      if (APPEND_HISTORY) {
        if (appendHistory(player, completedSeasonLine(landing, player.pos, ap.team))) {
          changedTeams.add(index.get(ap.norm)?.loc ?? ap.team)
          report.history.push(player.name)
        }
      }
      if (RETUNE) {
        const suggested = overallFrom(landing, player.pos, player.age)
        const step = clamp(suggested - player.overall, -3, 3)
        if (step !== 0) {
          const before = player.overall
          player.overall = clamp(before + step, 50, 99)
          if (player.potential < player.overall) player.potential = player.overall
          changedTeams.add(index.get(ap.norm)?.loc ?? ap.team)
          report.retunes.push({ name: player.name, from: before, to: player.overall })
        }
      }
    }
  }

  // ---- report ----
  const md = renderReport(report, { changedTeams, apiTeams })
  writeFileSync(REPORT_FILE, md)
  console.log(md)
  console.log(`\n(report written to ${REPORT_FILE})`)

  if (!APPLY) {
    console.log('\nDRY RUN — no team files written. Re-run with --apply to write.')
    return
  }

  // ---- apply: write changed files, then validate; restore on failure ----
  const written = []
  for (const t of changedTeams) {
    const p = join(TEAMS_DIR, `${t}.json`)
    writeFileSync(p, JSON.stringify(store[t], null, 2) + '\n'); written.push(p)
  }
  if (faChanged) { writeFileSync(FA_FILE, JSON.stringify(fa, null, 2) + '\n'); written.push(FA_FILE) }

  try {
    execFileSync('node', [VALIDATE], { stdio: 'pipe' })
    console.log(`\nAPPLIED ${written.length} file(s); validate-data passed.`)
  } catch (e) {
    for (const p of written) writeFileSync(p, original[p]) // restore byte-identical
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '')
    console.error('\nVALIDATION FAILED — restored originals. Validator said:\n' + out)
    console.error('No changes were kept. Fix the report items above and re-run.')
    process.exit(1)
  }
}

// history line from a raw seasonTotals row (used for NEW players' back-history)
function completedLineFromRow(row, pos, apiTeam) {
  const year = Math.floor((row.season ?? 0) / 10000)
  const team = (row.teamAbbrev || NAME_TO_ABBREV[row.teamName?.default] || apiTeam || '').toUpperCase()
  if (!/^[A-Z]{2,4}$/.test(team)) return null
  const g = row.goals ?? 0, a = row.assists ?? 0
  const line = {
    year, team, gp: row.gamesPlayed ?? 0,
    goals: pos === 'G' ? 0 : g, assists: pos === 'G' ? 0 : a,
    points: pos === 'G' ? 0 : g + a, plusMinus: row.plusMinus ?? 0, pim: row.pim ?? 0,
  }
  if (pos === 'G') {
    line.wins = row.wins ?? 0; line.losses = row.losses ?? 0
    line.otl = row.otLosses ?? row.otl ?? 0; line.shutouts = row.shutouts ?? 0
    if (row.goalsAgainstAvg ?? row.gaa) line.gaa = Math.round((row.goalsAgainstAvg ?? row.gaa) * 100) / 100
    if (row.savePctg ?? row.svPct) line.svPct = Math.round((row.savePctg ?? row.svPct) * 1000) / 1000
  }
  return line
}

function renderReport(r, meta) {
  const L = []
  L.push('# Roster update report')
  L.push('')
  L.push(`- Season: **${SEASON}** (completed season appended as year ${COMPLETED_YEAR})`)
  L.push(`- Source: ${FIXTURES ? `fixtures (${FIXTURES})` : 'NHL public API'}`)
  L.push(`- Teams processed: ${meta.apiTeams.length}`)
  L.push(`- Flags: append-history=${APPEND_HISTORY} retune=${RETUNE} apply=${APPLY}`)
  L.push('')
  L.push(`**Summary:** ${r.moves.length} moved, ${r.adds.length} new, ${r.departures.length} to FA, `
    + `${r.retired.length} retired, ${r.kept.length} kept-flagged, ${r.history.length} history, ${r.retunes.length} retuned.`)
  const sec = (title, rows) => { L.push(''); L.push(`## ${title} (${rows.length})`); if (!rows.length) L.push('_none_'); else rows.forEach((x) => L.push(`- ${x}`)) }
  sec('Moved', r.moves.map((m) => `${m.name}: ${m.from} -> ${m.to}${m.kind !== 'roster' ? ` (was ${m.kind})` : ''}`))
  sec('New to NHL', r.adds.map((a) => `${a.name} (${a.pos}, ${a.team}) — OVR ${a.overall}/POT ${a.potential}, id ${a.id}`))
  sec('Flagged contracts (manual review vs PuckPedia)', r.flagged.map((f) => `${f.name} (${f.team}) — placeholder capHit ${f.contract.capHit}, ${f.contract.yearsLeft}yr ${f.contract.expiry}`))
  sec('Departed -> free agency', r.departures.map((d) => `${d.name} (from ${d.team})`))
  sec('Likely retired (removed)', r.retired.map((d) => `${d.name} (${d.team}, age ${d.age}, OVR ${d.overall})`))
  sec('Kept despite absence (roster minimum)', r.kept.map((k) => `${k.name} (${k.team}) — ${k.reason}`))
  sec('History appended', r.history.map((n) => `${n}`))
  sec('Retuned overalls', r.retunes.map((t) => `${t.name}: ${t.from} -> ${t.to}`))
  return L.join('\n') + '\n'
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })

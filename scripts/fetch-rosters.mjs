#!/usr/bin/env node
// fetch-rosters.mjs — refresh data/teams/*.json from the NHL public API.
//
// Rosters:  https://api-web.nhle.com/v1/roster/{TEAM}/20252026
// Player:   https://api-web.nhle.com/v1/player/{id}/landing
//
// Ratings: the NHL API has no "overall", so we DERIVE one from last season's
// stats with the documented formula in `skaterOverall` / `goalieOverall` below.
// It's an approximation meant to be hand-tuned afterward.
//
// CONTRACTS: the API exposes no contract/cap data. This script PRESERVES the
// contract (and nationality/potential/age overrides) from the EXISTING JSON by
// player id where possible. Contract data in the bundled snapshot came from
// PuckPedia and can be updated manually there. New players get a league-minimum
// placeholder contract you should correct by hand.
//
// Network is required (and is blocked in the authoring sandbox, so this script
// is untested there). Run locally:  node scripts/fetch-rosters.mjs
//
// Standalone: no dependencies beyond Node builtins.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data', 'teams')
const SEASON = '20252026'

const TEAMS = [
  'ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET', 'EDM', 'FLA',
  'LAK', 'MIN', 'MTL', 'NJD', 'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS',
  'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG', 'WSH',
]

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'hockey-dynasty/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)
const round = (x) => Math.round(x)

// ---- rating formulas (documented approximations) --------------------------
// Skater: base 68, scaled by points-per-game and games played last season.
// A ~1.0 P/GP top-liner lands ~90; a 0.3 P/GP depth player ~76; sub-replacement
// or no data ~70. Defensemen weight points less and get a small floor bump.
function skaterOverall(landing, pos) {
  const sub = lastSeasonSubStat(landing, false)
  if (!sub) return 74
  const gp = sub.gamesPlayed ?? 0
  const pts = sub.points ?? 0
  const ppg = gp > 0 ? pts / gp : 0
  const isD = pos === 'D'
  let ovr = 68 + (isD ? ppg * 26 : ppg * 24)
  if (gp < 25) ovr -= 4 // small sample / part-time
  if (isD) ovr += 3 // defensemen produce fewer points for the same value
  return round(clamp(ovr, 62, 97))
}

// Goalie: base 70, scaled by save percentage (a .920 SV% ~= 90, .900 ~= 78).
function goalieOverall(landing) {
  const sub = lastSeasonSubStat(landing, true)
  if (!sub) return 74
  const gp = sub.gamesPlayed ?? 0
  const svp = sub.savePctg ?? 0.9
  let ovr = 70 + (svp - 0.9) * 600
  if (gp < 20) ovr -= 3
  return round(clamp(ovr, 62, 95))
}

// Pull the most recent NHL regular-season sub-season stat block.
function lastSeasonSubStat(landing, goalie) {
  const seasons = landing?.seasonTotals ?? []
  const nhl = seasons.filter((r) => r.leagueAbbrev === 'NHL' && r.gameTypeId === 2)
  if (nhl.length === 0) return null
  return nhl[nhl.length - 1]
}

function posFromCode(code) {
  if (code === 'L') return 'LW'
  if (code === 'R') return 'RW'
  if (code === 'C') return 'C'
  if (code === 'D') return 'D'
  if (code === 'G') return 'G'
  return 'C'
}

function nationality(landing) {
  return landing?.birthCountry ?? 'CAN'
}

function ageAsOf(landing) {
  const bd = landing?.birthDate
  if (!bd) return 25
  const born = new Date(bd)
  const ref = new Date('2025-10-01')
  let age = ref.getFullYear() - born.getFullYear()
  const m = ref.getMonth() - born.getMonth()
  if (m < 0 || (m === 0 && ref.getDate() < born.getDate())) age--
  return age
}

async function buildTeam(abbrev, existing) {
  const roster = await getJSON(`https://api-web.nhle.com/v1/roster/${abbrev}/${SEASON}`)
  const groups = [...(roster.forwards ?? []), ...(roster.defensemen ?? []), ...(roster.goalies ?? [])]

  // Index existing players by id to preserve contract/potential.
  const prevById = new Map()
  for (const p of [...(existing?.roster ?? []), ...(existing?.prospects ?? [])]) prevById.set(p.id, p)

  const rosterOut = []
  for (const entry of groups) {
    const id = `${abbrev}-${(entry.lastName?.default ?? 'x').toLowerCase().replace(/[^a-z]/g, '')}`
    let landing = null
    try {
      landing = await getJSON(`https://api-web.nhle.com/v1/player/${entry.id}/landing`)
    } catch (e) {
      console.warn(`  ! player ${entry.id} landing failed: ${e.message}`)
    }
    const pos = posFromCode(entry.positionCode)
    const prev = prevById.get(id)
    const overall = pos === 'G' ? goalieOverall(landing) : skaterOverall(landing, pos)
    const age = ageAsOf(landing)
    const player = {
      id,
      name: `${entry.firstName?.default ?? ''} ${entry.lastName?.default ?? ''}`.trim(),
      pos,
      age: prev?.age ?? age,
      shoots: entry.shootsCatches ?? prev?.shoots ?? 'L',
      overall,
      potential: prev?.potential ?? (age < 25 ? clamp(overall + 6, overall, 99) : overall),
      nationality: nationality(landing) || prev?.nationality || 'CAN',
      // Preserve real contract from the snapshot; placeholder otherwise.
      contract: prev?.contract ?? { capHit: 0.775, yearsLeft: 1, expiry: age < 27 ? 'RFA' : 'UFA' },
    }
    rosterOut.push(player)
  }

  return {
    info: existing?.info ?? { abbrev, city: abbrev, name: abbrev, conference: 'East', division: 'Atlantic', color: '#204080' },
    roster: rosterOut,
    // Prospects are not exposed by the roster endpoint — keep the existing ones.
    prospects: existing?.prospects ?? [],
  }
}

async function main() {
  if (typeof fetch !== 'function') {
    console.error('This script needs Node 18+ (global fetch).')
    process.exit(1)
  }
  let ok = 0
  let failed = 0
  for (const abbrev of TEAMS) {
    const file = join(DATA_DIR, `${abbrev}.json`)
    let existing = null
    if (existsSync(file)) {
      try {
        existing = JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        console.warn(`  ! ${abbrev}.json unreadable — regenerating from scratch`)
      }
    }
    try {
      process.stdout.write(`Fetching ${abbrev}... `)
      const team = await buildTeam(abbrev, existing)
      writeFileSync(file, JSON.stringify(team, null, 2) + '\n')
      console.log(`ok (${team.roster.length} players)`)
      ok++
    } catch (e) {
      console.error(`FAILED: ${e.message}`)
      failed++
    }
  }
  console.log(`\nDone: ${ok} teams written, ${failed} failed.`)
  console.log('NOTE: ratings are derived approximations and contracts were preserved from the')
  console.log('existing snapshot (PuckPedia-sourced). Review new players and re-run validate-data.')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})

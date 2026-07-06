// Validates data/teams/*.json against DATA_SPEC.md rules.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('../data/teams/', import.meta.url).pathname
const EXPECTED = {
  Atlantic: ['BOS', 'BUF', 'DET', 'FLA', 'MTL', 'OTT', 'TBL', 'TOR'],
  Metropolitan: ['CAR', 'CBJ', 'NJD', 'NYI', 'NYR', 'PHI', 'PIT', 'WSH'],
  Central: ['CHI', 'COL', 'DAL', 'MIN', 'NSH', 'STL', 'UTA', 'WPG'],
  Pacific: ['ANA', 'CGY', 'EDM', 'LAK', 'SJS', 'SEA', 'VAN', 'VGK'],
}
const ALL = Object.values(EXPECTED).flat()
const POS = new Set(['C', 'LW', 'RW', 'D', 'G'])
const errors = []
const warns = []
const seenIds = new Set()
const seenNames = new Map()

let files = []
try {
  files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
} catch {
  console.error('data/teams/ does not exist yet')
  process.exit(1)
}

const present = files.map((f) => f.replace('.json', ''))
for (const t of ALL) if (!present.includes(t)) errors.push(`missing team file: ${t}.json`)
for (const t of present) if (!ALL.includes(t)) errors.push(`unexpected team file: ${t}.json`)

function checkPlayer(p, team, kind) {
  const ctx = `${team}/${kind}/${p.name ?? p.id ?? '?'}`
  if (!p.id || typeof p.id !== 'string') errors.push(`${ctx}: bad id`)
  else if (seenIds.has(p.id)) errors.push(`${ctx}: duplicate id ${p.id}`)
  else seenIds.add(p.id)
  if (!p.name) errors.push(`${ctx}: missing name`)
  else {
    if (seenNames.has(p.name)) warns.push(`duplicate name "${p.name}" in ${seenNames.get(p.name)} and ${team} (ok if two real players share it)`)
    seenNames.set(p.name, team)
  }
  if (!POS.has(p.pos)) errors.push(`${ctx}: bad pos ${p.pos}`)
  if (!Number.isInteger(p.age) || p.age < 18 || p.age > 45) errors.push(`${ctx}: bad age ${p.age}`)
  if (!['L', 'R'].includes(p.shoots)) errors.push(`${ctx}: bad shoots`)
  if (!Number.isInteger(p.overall) || p.overall < 50 || p.overall > 99) errors.push(`${ctx}: bad overall ${p.overall}`)
  if (!Number.isInteger(p.potential) || p.potential < p.overall) errors.push(`${ctx}: potential ${p.potential} < overall ${p.overall}`)
  if (p.age >= 28 && p.potential > p.overall) warns.push(`${ctx}: age ${p.age} but potential > overall`)
  const c = p.contract
  if (kind === 'roster') {
    if (!c) return errors.push(`${ctx}: roster player must have contract`)
  }
  if (c) {
    if (typeof c.capHit !== 'number' || c.capHit < 0.7 || c.capHit > 16) errors.push(`${ctx}: bad capHit ${c.capHit}`)
    if (!Number.isInteger(c.yearsLeft) || c.yearsLeft < 1 || c.yearsLeft > 8) errors.push(`${ctx}: bad yearsLeft ${c.yearsLeft}`)
    if (!['RFA', 'UFA'].includes(c.expiry)) errors.push(`${ctx}: bad expiry`)
  }
}

for (const f of files) {
  const team = f.replace('.json', '')
  let d
  try {
    d = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
  } catch (e) {
    errors.push(`${team}: invalid JSON — ${e.message}`)
    continue
  }
  const info = d.info ?? {}
  if (info.abbrev !== team) errors.push(`${team}: info.abbrev mismatch (${info.abbrev})`)
  const div = Object.entries(EXPECTED).find(([, ts]) => ts.includes(team))?.[0]
  if (info.division !== div) errors.push(`${team}: division should be ${div}, got ${info.division}`)
  const conf = div === 'Atlantic' || div === 'Metropolitan' ? 'East' : 'West'
  if (info.conference !== conf) errors.push(`${team}: conference should be ${conf}`)
  if (!/^#[0-9a-fA-F]{6}$/.test(info.color ?? '')) errors.push(`${team}: bad color`)
  if (!info.city || !info.name) errors.push(`${team}: missing city/name`)

  const roster = d.roster ?? []
  const prospects = d.prospects ?? []
  if (roster.length < 21 || roster.length > 23) errors.push(`${team}: roster size ${roster.length} (need 21-23)`)
  if (prospects.length < 3 || prospects.length > 6) errors.push(`${team}: prospects ${prospects.length} (need 3-6)`)
  const byPos = { F: 0, D: 0, G: 0 }
  for (const p of roster) byPos[p.pos === 'D' ? 'D' : p.pos === 'G' ? 'G' : 'F']++
  if (byPos.F < 12 || byPos.F > 14) errors.push(`${team}: ${byPos.F} forwards (need 12-14)`)
  if (byPos.D < 6 || byPos.D > 8) errors.push(`${team}: ${byPos.D} defensemen (need 6-8)`)
  if (byPos.G < 2 || byPos.G > 3) errors.push(`${team}: ${byPos.G} goalies (need 2-3)`)
  for (const p of roster) checkPlayer(p, team, 'roster')
  for (const p of prospects) checkPlayer(p, team, 'prospects')
  const capTotal = roster.reduce((s, p) => s + (p.contract?.capHit ?? 0), 0)
  if (capTotal < 78 || capTotal > 95.5) errors.push(`${team}: cap total $${capTotal.toFixed(2)}M outside 78-95.5`)
  const avg = roster.reduce((s, p) => s + p.overall, 0) / roster.length
  if (avg < 74 || avg > 86) warns.push(`${team}: avg overall ${avg.toFixed(1)} looks off (expect ~76-84)`)
}

for (const w of warns) console.log('WARN:', w)
if (errors.length) {
  for (const e of errors) console.error('ERROR:', e)
  console.error(`\n${errors.length} error(s)`)
  process.exit(1)
}
console.log(`OK — ${files.length} team files valid, ${seenIds.size} players, ${warns.length} warning(s)`)

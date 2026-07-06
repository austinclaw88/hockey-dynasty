// 82-game schedule generation. Every team plays exactly 82 games over ~185
// calendar days (Oct 8 -> Apr 10). Not the exact NHL formula, but a valid,
// balanced round-robin-ish mix with home/away roughly split.
import type { Game, TeamState } from '../types.ts'
import type { Rng } from './rng.ts'

export const SEASON_DAYS = 185

/** Games between a pair of teams so every team totals exactly 82:
 *  base 2 vs everyone (62) + 2 extra vs each of 7 division rivals (14) +
 *  a 6-regular bipartite bump vs the same-conference other division (6) = 82. */
function gamesForPair(a: TeamState, b: TeamState, aIdx: number, bIdx: number, confDiv: Map<string, { conf: string; div: string; ord: number }>): number {
  const ai = confDiv.get(a.abbrev)!
  const bi = confDiv.get(b.abbrev)!
  let n = 2 // base vs everyone
  if (ai.div === bi.div) {
    n += 2 // division rivals -> 4
  } else if (ai.conf === bi.conf) {
    // Same conference, different division: 6-regular circulant bump on the two
    // 8-team divisions. Exclude two symmetric opponents (same ord and the
    // opposite ord) so every team gets exactly +6.
    const x = ai.ord
    const y = bi.ord
    if (y !== x && y !== (x + 4) % 8) n += 1
  }
  return n
}

export function buildSchedule(teams: Record<string, TeamState>, rng: Rng): Game[] {
  const abbrevs = Object.keys(teams)
  // Assign each team an index within its division (0..7) for the circulant bump.
  const confDiv = new Map<string, { conf: string; div: string; ord: number }>()
  const divCount = new Map<string, number>()
  for (const abbr of abbrevs) {
    const t = teams[abbr]
    const key = t.division
    const ord = divCount.get(key) ?? 0
    divCount.set(key, ord + 1)
    confDiv.set(abbr, { conf: t.conference, div: t.division, ord })
  }

  // Build all game instances (home/away alternating within a pair).
  const games: { home: string; away: string }[] = []
  for (let i = 0; i < abbrevs.length; i++) {
    for (let j = i + 1; j < abbrevs.length; j++) {
      const a = teams[abbrevs[i]]
      const b = teams[abbrevs[j]]
      const n = gamesForPair(a, b, i, j, confDiv)
      for (let k = 0; k < n; k++) {
        if (k % 2 === 0) games.push({ home: a.abbrev, away: b.abbrev })
        else games.push({ home: b.abbrev, away: a.abbrev })
      }
    }
  }

  // Greedily assign days, ensuring no team plays twice on a day. Capacity is
  // large (~7 games/day of a 16-game ceiling), so a wrap-around scan always
  // finds a slot.
  const busy: Set<string>[] = Array.from({ length: SEASON_DAYS }, () => new Set<string>())
  rng.shuffle(games)
  const placed: Game[] = []
  let idCounter = 0
  for (const g of games) {
    let d = rng.int(0, SEASON_DAYS - 1)
    let tries = 0
    while (tries < SEASON_DAYS && (busy[d].has(g.home) || busy[d].has(g.away))) {
      d = (d + 1) % SEASON_DAYS
      tries++
    }
    busy[d].add(g.home)
    busy[d].add(g.away)
    placed.push({ id: idCounter++, day: d, home: g.home, away: g.away, played: false })
  }

  placed.sort((a, b) => a.day - b.day || a.id - b.id)
  placed.forEach((g, i) => (g.id = i))
  return placed
}

/** Human-readable date label for a 0-based day index (Oct 8 -> Apr 10). */
export function dayLabel(day: number): string {
  const start = new Date(2025, 9, 8) // Oct 8
  const d = new Date(start.getTime() + day * 86400000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

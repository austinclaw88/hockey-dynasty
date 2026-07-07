// Draft: prospect-class generation, lottery, draft order, and pick logic.
import type { GameState, Player, Position, DraftPick } from '../types.ts'
import type { Rng } from './rng.ts'
import { generateName, pickNationality } from './names.ts'
import { clamp, ext, rosterCounts, pushNews, type DraftResult } from './helpers.ts'
import { reverseStandingsOrder } from './standings.ts'

// Three rounds (96 picks: 32 teams x 3) plus margin for undrafted depth.
const CLASS_SIZE = 110
const ROUNDS = 3

/** Round (1-based) that draft slot `slot` belongs to, given the full order length. */
function roundOfSlot(orderLen: number, slot: number): number {
  const perRound = orderLen / ROUNDS
  return Math.min(ROUNDS, Math.floor(slot / perRound) + 1)
}

/** Generate `n` fictional prospects for slots [start, start+n). */
function generateProspects(rng: Rng, year: number, start: number, n: number): Player[] {
  // Position pool ~ 34 F / 25 D / 7 G (skater forwards split C/LW/RW).
  const positions: Position[] = []
  for (let i = 0; i < 12; i++) positions.push('C')
  for (let i = 0; i < 11; i++) positions.push('LW')
  for (let i = 0; i < 11; i++) positions.push('RW')
  for (let i = 0; i < 25; i++) positions.push('D')
  for (let i = 0; i < 7; i++) positions.push('G')
  while (positions.length < start + n) positions.push('C')
  rng.shuffle(positions)

  const players: Player[] = []
  for (let k = 0; k < n; k++) {
    const i = start + k // global rank slot (0 = franchise talent)
    // Keep the gem bands FIXED (same count of franchise/top-6 talents regardless
    // of class size — do not triple the gems). Extra picks land in the mid and
    // late-round depth tiers (late-3rd prospects ~55-62 OVR / 70-80 potential).
    let potential: number
    let overall: number
    if (i < 3) {
      potential = rng.int(90, 96)
      overall = clamp(potential - rng.int(10, 28), 55, 72)
    } else if (i < 13) {
      potential = rng.int(83, 89)
      overall = clamp(potential - rng.int(10, 28), 55, 72)
    } else if (i < 60) {
      potential = rng.int(68, 82)
      overall = clamp(potential - rng.int(10, 28), 55, 72)
    } else {
      potential = rng.int(70, 80)
      overall = clamp(potential - rng.int(12, 22), 55, 62)
    }
    const nationality = pickNationality(rng)
    const pos = positions[k]
    players.push({
      id: `DP-${year}-${i}`,
      name: generateName(rng, nationality),
      pos,
      age: 18,
      shoots: rng.chance(0.7) ? 'L' : 'R',
      overall,
      potential: Math.max(potential, overall),
      contract: null,
      nationality,
      injuryWeeks: 0,
      retired: false,
    })
  }
  return players
}

/** Convert a real draft-class file entry into an 18-year-old draft prospect
 *  (unsigned, hidden potential from the file, devLeague preserved, no history). */
function toRealProspect(raw: Omit<Player, 'injuryWeeks' | 'retired'>): Player {
  const { history: _history, ...rest } = raw
  return {
    ...rest,
    age: 18,
    contract: null,
    potential: Math.max(raw.potential, raw.overall),
    injuryWeeks: 0,
    retired: false,
  }
}

/** Generate a fresh draft class with nationality-weighted names and a skewed
 *  potential distribution (a few franchise talents, some top-6/top-4, rest mid).
 *  When `real` prospects are supplied (the real projected class from
 *  data/draft-2027.json), they anchor the top of the board in file order
 *  (index 0 = best) and the rest of the class is topped up with generated
 *  prospects to the usual size. */
export function generateDraftClass(rng: Rng, year: number, real?: Omit<Player, 'injuryWeeks' | 'retired'>[]): Player[] {
  if (real && real.length > 0) {
    const anchors = real.slice(0, CLASS_SIZE).map(toRealProspect)
    const fillers = generateProspects(rng, year, anchors.length, Math.max(0, CLASS_SIZE - anchors.length))
    // Keep the real players in file order at the front (file order ~ board rank);
    // shuffle only the generated filler among themselves (busts/steals).
    rng.shuffle(fillers)
    return [...anchors, ...fillers]
  }
  const players = generateProspects(rng, year, 0, CLASS_SIZE)
  // Shuffle so the "best available" order isn't index order (busts/steals).
  rng.shuffle(players)
  return players
}

/** Draft order: reverse standings with a bottom-5 lottery for #1 overall. */
export function buildDraftOrder(s: GameState, rng: Rng): string[] {
  const worstFirst = reverseStandingsOrder(s) // 32 teams, worst -> best
  const bottom5 = worstFirst.slice(0, 5)
  const weights = [25, 18, 14, 10, 8]
  let total = weights.reduce((a, b) => a + b, 0)
  let r = rng.float(0, total)
  let winnerIdx = 0
  for (let i = 0; i < bottom5.length; i++) {
    if (r < weights[i]) {
      winnerIdx = i
      break
    }
    r -= weights[i]
  }
  const round1 = [...worstFirst]
  if (winnerIdx > 0) {
    const [winner] = round1.splice(winnerIdx, 1)
    round1.unshift(winner)
  }
  // Rounds 2 and 3 reuse the same reverse-standings order.
  return [...round1, ...round1, ...round1]
}

/** Scouting value used by AI to rank prospects (blend + slight need bias). */
function scoutValue(p: Player, need: { f: number; d: number; g: number }): number {
  let v = p.potential * 0.6 + p.overall * 0.4
  if (p.pos === 'G' && need.g < 2) v += 3
  if (p.pos === 'D' && need.d < 7) v += 1.5
  return v
}

function elcContract(): NonNullable<Player['contract']> {
  return { capHit: 0.95, yearsLeft: 3, expiry: 'RFA' }
}

function ownerOfSlot(s: GameState, slot: number): string {
  const order = s.draftOrder!
  const originalTeam = order[slot]
  const round = roundOfSlot(order.length, slot)
  const year = s.seasonYear + 1
  for (const abbr of Object.keys(s.teams)) {
    if (s.teams[abbr].picks.some((pk) => pk.year === year && pk.round === round && pk.originalTeam === originalTeam)) {
      return abbr
    }
  }
  return originalTeam // fallback (pick untracked)
}

function removePick(s: GameState, owner: string, originalTeam: string, round: number): void {
  const year = s.seasonYear + 1
  const t = s.teams[owner]
  const idx = t.picks.findIndex((pk) => pk.year === year && pk.round === round && pk.originalTeam === originalTeam)
  if (idx >= 0) t.picks.splice(idx, 1)
}

function assignPlayer(s: GameState, owner: string, player: Player, slot: number): void {
  player.contract = elcContract()
  player.age = 18
  s.teams[owner].prospects.push(player)
  const es = ext(s)
  if (!es._draftResults) es._draftResults = []
  const result: DraftResult = { pick: slot + 1, team: owner, playerName: player.name }
  es._draftResults.push(result)
}

/** AI makes the pick at `slot`. */
export function aiDraftPick(s: GameState, slot: number, rng: Rng): void {
  const owner = ownerOfSlot(s, slot)
  const originalTeam = s.draftOrder![slot]
  const round = roundOfSlot(s.draftOrder!.length, slot)
  const need = rosterCounts(s.teams[owner])
  let best: Player | null = null
  let bestVal = -Infinity
  for (const p of s.draftClass) {
    const v = scoutValue(p, need) + rng.float(-2, 2)
    if (v > bestVal) {
      bestVal = v
      best = p
    }
  }
  if (!best) return
  s.draftClass = s.draftClass.filter((p) => p.id !== best!.id)
  assignPlayer(s, owner, best, slot)
  removePick(s, owner, originalTeam, round)
}

/** Advance AI picks until it's the user's turn or the draft is complete. */
export function autoAdvanceDraft(s: GameState, rng: Rng): void {
  const order = s.draftOrder!
  while (s.day < order.length) {
    const owner = ownerOfSlot(s, s.day)
    if (owner === s.userTeam && s.draftClass.length > 0) break
    aiDraftPick(s, s.day, rng)
    s.day++
  }
}

/** Finish any remaining picks (used when leaving the draft step). */
export function finishDraft(s: GameState, rng: Rng): void {
  const order = s.draftOrder!
  while (s.day < order.length) {
    aiDraftPick(s, s.day, rng)
    s.day++
  }
}

export interface DraftBoard {
  onClock: string
  pickNumber: number
  available: Player[]
  results: DraftResult[]
}

export function draftBoard(s: GameState): DraftBoard {
  const order = s.draftOrder ?? []
  const done = s.day >= order.length
  return {
    onClock: done ? '' : ownerOfSlot(s, s.day),
    pickNumber: s.day + 1,
    available: s.draftClass,
    results: ext(s)._draftResults ?? [],
  }
}

/** User makes their pick at the current slot, then AI continues. */
export function doDraftPlayer(s: GameState, playerId: string, rng: Rng): void {
  const order = s.draftOrder
  if (!order || s.day >= order.length) return
  if (ownerOfSlot(s, s.day) !== s.userTeam) return
  const player = s.draftClass.find((p) => p.id === playerId)
  if (!player) return
  const originalTeam = order[s.day]
  const round = roundOfSlot(order.length, s.day)
  s.draftClass = s.draftClass.filter((p) => p.id !== player.id)
  assignPlayer(s, s.userTeam, player, s.day)
  removePick(s, s.userTeam, originalTeam, round)
  s.day++
  autoAdvanceDraft(s, rng)
}

/** Potential-weighted board value used to rank the best available prospect. */
function boardValue(p: Player): number {
  return p.potential * 0.7 + p.overall * 0.3
}

function bestAvailable(s: GameState): Player | undefined {
  let best: Player | undefined
  let bestVal = -Infinity
  for (const p of s.draftClass) {
    const v = boardValue(p)
    if (v > bestVal) {
      bestVal = v
      best = p
    }
  }
  return best
}

/** Autodraft the user's CURRENT pick with the best available prospect by
 *  potential-weighted board value, then let AI continue to the next user slot.
 *  No-op unless the user is on the clock in the draft step. */
export function doAutoDraftPick(s: GameState, rng: Rng): void {
  const order = s.draftOrder
  if (!order || s.day >= order.length) return
  if (ownerOfSlot(s, s.day) !== s.userTeam) return
  const best = bestAvailable(s)
  if (!best) return
  doDraftPlayer(s, best.id, rng)
}

/** Autodraft ALL remaining user picks (best available each time) and let the AI
 *  finish the round order until the draft is complete. */
export function doAutoCompleteDraft(s: GameState, rng: Rng): void {
  const order = s.draftOrder
  if (!order) return
  let guard = 0
  while (s.day < order.length && guard++ < order.length + 5) {
    if (s.draftClass.length === 0) {
      s.day = order.length
      break
    }
    if (ownerOfSlot(s, s.day) === s.userTeam) doAutoDraftPick(s, rng)
    else {
      aiDraftPick(s, s.day, rng)
      s.day++
    }
  }
}

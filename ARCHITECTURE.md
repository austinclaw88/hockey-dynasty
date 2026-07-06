# Hockey Dynasty — Architecture

A browser-only NHL dynasty/franchise-mode manager (think EA NHL franchise mode **without** playable games).
The user picks one of the 32 real NHL teams with its real 2025-26 roster and real contracts, then manages it
for 10 seasons (2025-26 → 2034-35): simulate the schedule, make trades, re-sign players, sign free agents,
draft prospects, and watch players develop, age, and retire.

## Stack

- Vite + React 18 + TypeScript, **strict mode**. No router, no state library, no CSS framework, no other runtime deps.
- All state lives in a single `GameState` object (see `src/types.ts`) managed by a React reducer in `src/App.tsx`.
- Saves: `JSON.stringify(GameState)` in `localStorage` (key `hockey-dynasty-save`). Auto-save after every sim/action.
- Data: 32 static JSON files in `data/teams/*.json` (shape: `TeamDataFile`), imported at build time via
  `src/data/index.ts` which does `import tor from '../../data/teams/TOR.json'` etc. and exports
  `TEAM_DATA: TeamDataFile[]`. This keeps the single-file build self-contained.
- Deterministic seeded RNG (mulberry32) threaded through the engine via `GameState.rngState` — never `Math.random()`.

## Module layout & ownership

| Path | Owner | Contents |
|---|---|---|
| `src/types.ts` | FROZEN — already written | Shared type contract |
| `data/teams/*.json` | data agents | 32 team files |
| `src/data/index.ts` | data agents (Atlantic agent writes it) | imports all 32 JSONs, exports `TEAM_DATA` |
| `src/engine/**` | engine agent | pure logic, NO React imports, NO DOM |
| `src/ui/**`, `src/App.tsx`, `src/main.tsx`, `src/styles.css` | UI agent | all React components |
| `scripts/validate-data.mjs` | FROZEN — already written | data sanity checks |
| `scripts/sim-test.ts` | engine agent | headless 10-season smoke test |
| `scripts/fetch-rosters.mjs` | engine agent | optional roster refresher from NHL API (for users running locally) |

Agents must ONLY touch paths they own. Integration fixes happen in a later pass.

## Engine public API — `src/engine/index.ts`

The UI calls ONLY these functions. All are pure-ish: they take `GameState` and return a NEW `GameState`
(no in-place mutation of the argument; internal structural sharing is fine).

```ts
// setup
newGame(userTeam: string): GameState                    // builds full league from TEAM_DATA, generates schedule

// simulation (regular season + playoffs)
simDays(s: GameState, days: number): GameState          // plays all games in the next N calendar days
simToEndOfSeason(s: GameState): GameState
simPlayoffRound(s: GameState): GameState                // advances playoffs one round (sims all series)

// derived views (read-only helpers)
getStandings(s: GameState): { league: StandingsRow[]; byDivision: Record<Division, StandingsRow[]> }
getLeaders(s: GameState): { points: SeasonStatLine[]; goals: SeasonStatLine[]; goalies: SeasonStatLine[] } // top 20 each
getCapUsage(s: GameState, team: string): { used: number; cap: number; space: number }
findPlayer(s: GameState, id: string): { player: Player; team?: string } | null

// offseason — call advanceOffseason() to move through steps in order:
// awards -> development -> resign -> draft -> freeAgency -> rosterCheck -> next season (phase 'regular')
advanceOffseason(s: GameState): GameState
// during 'resign': user decisions on own expiring contracts
resignPlayer(s: GameState, playerId: string, years: number, capHit: number): { s: GameState; ok: boolean; reason?: string }
letWalk(s: GameState, playerId: string): GameState      // expiring player goes to FA pool
getResignAsking(s: GameState, playerId: string): { capHit: number; years: number }
// during 'draft': draft proceeds pick-by-pick; AI picks auto-advance until it's the user's pick
draftPlayer(s: GameState, playerId: string): GameState  // user makes their pick, then AI continues to next user pick
getDraftBoard(s: GameState): { onClock: string; pickNumber: number; available: Player[]; results: {pick:number; team:string; playerName:string}[] }
// during 'freeAgency': day-based; each advanceFreeAgencyDay, AI teams sign players
signFreeAgent(s: GameState, playerId: string, years: number, capHit: number): { s: GameState; ok: boolean; reason?: string }
advanceFreeAgencyDay(s: GameState): GameState           // ~5 FA days total, then step is done
// roster moves (any time)
callUp(s: GameState, playerId: string): { s: GameState; ok: boolean; reason?: string }     // prospect -> roster
sendDown(s: GameState, playerId: string): { s: GameState; ok: boolean; reason?: string }   // roster -> prospects (age<=25 & overall<=78 only)

// trades (regular season before day ~120 = deadline, and offseason freeAgency step)
evaluateTrade(s: GameState, offer: TradeOffer): { accept: boolean; verdict: string; delta: number }
executeTrade(s: GameState, offer: TradeOffer): { s: GameState; ok: boolean; reason?: string }
getAiTradeSuggestion(s: GameState, partner: string): TradeOffer | null

interface TradeOffer {
  from: string; to: string                 // team abbrevs; from = user
  fromPlayers: string[]; toPlayers: string[]   // player ids
  fromPicks: DraftPick[]; toPicks: DraftPick[]
}

// persistence
saveGame(s: GameState): void
loadGame(): GameState | null
hasSave(): boolean
deleteSave(): void
```

## Simulation model (engine internals — `src/engine/sim.ts`)

No play-by-play. Each game is resolved statistically:

1. **Team strength** from the ACTIVE roster (healthy, best players auto-selected: 12 F, 6 D, starter G by overall):
   - `off = 0.65 * wAvg(top9 F overalls) + 0.35 * wAvg(top4 D overalls)` (weight top-3 F double)
   - `def = 0.55 * wAvg(top6 D) + 0.45 * wAvg(top12 F)`
   - `goalie = starter overall` (backup starts ~25% of games, tracked so goalie stats split)
2. **Expected goals**: league mean 3.05/team/game, scaled: `xg = 3.05 * 1.10^((off_A - def_B)/6) * 1.08^((78 - goalie_B)/6)`, clamp [1.4, 5.2]. Home team +4% xg.
3. Sample goals from Poisson. If tied after regulation, one team wins in OT/SO (60/40 OT vs SO, better team 55%).
4. **Attribution**: each goal assigned to a scorer on the winning-of-that-goal team weighted by
   `(overall - 55)^2` with forwards 4x D weight; 0-2 assists similarly. +/- and PIM lightly randomized.
   Goalie line gets the GA/SA (shots ~ 27-34) for SV% and GAA.
5. **Injuries**: per team-game ~3% chance a random player is injured 1-6 weeks (news item; auto next-man-up).

Roughly 1312 games/season; must sim a full season in well under a second.

## Season calendar

- 82 games/team generated round-robin-ish: 4 vs each division rival (32... just approximate: build a
  schedule where each team plays 82 with realistic mix; exact NHL formula not required, but every team
  must total exactly 82, home/away roughly balanced), spread over 185 days (Oct 8 → Apr 10 labels).
- Trade deadline at day 120 — after that, `executeTrade` rejects until offseason FA step.
- Playoffs: top 3 per division + 2 wildcards per conference, NHL bracket, best-of-7 (2-2-1-1-1 irrelevant — just sim 4-7 games).

## Player development (`src/engine/development.ts`) — run each offseason

- age += 1 for everyone. Then adjust overall (seeded random within ranges, nudged by last season's points/60-ish performance vs expectation):
  - age <= 22: +1..+5 toward potential (never exceed potential)
  - 23-25: +0..+3 toward potential
  - 26-29: -1..+1 (potential = max(potential, overall))
  - 30-32: -2..0
  - 33-35: -3..-1
  - 36+: -5..-2
  - Goalies: shift all bands +2 years (develop later, last longer).
- **Retirement**: after decline, players retire with probability: age>=41 always; 38+ 60%; 35+ if overall<74 50%; any 33+ with overall<70 40%.
- Prospects with overall >= 72 get auto-promoted by AI teams if roster space; user promotes manually.

## Contracts, cap, free agency (`src/engine/contracts.ts`)

- `SALARY_CAP` table in types.ts. Cap check = sum of roster capHits (prospects don't count).
- Offseason: `yearsLeft -= 1` (during 'resign' step start); at 0 the player becomes RFA (age < 27) or UFA.
- **Asking price** `askCapHit`: percentage of cap by overall — 95+: ~14-15%; 90-94: ~10-13%; 85-89: ~7-9.5%;
  80-84: ~4.5-6.5%; 75-79: ~2-4%; 70-74: ~1-1.8%; <70: ~0.85-1. Age 30+ discount 10-20%; RFA discount ~15%;
  high-potential young players ask longer term. Years asked: stars 6-8, mid 3-5, old/depth 1-2.
- RFAs: re-sign at asking always succeeds; lowball (< 90% ask) risks holdout (misses 20 games) — keep simple: reject below 90%.
- UFAs: at/above asking succeeds; 90-100% = 50/50; below 90% rejected.
- AI FA logic per FA day: each AI team with cap space + roster need signs best available fitting need; stars sign days 1-2.
- Every roster must end offseason with 20-23 players, >= 2 G, >= 6 D, >= 12 F; AI auto-fixes with cheap generated depth signings ("Journeyman" pool) if short.

## Draft (`src/engine/draft.ts`)

- 2 rounds (64 picks) — teams own their natural picks for all 10 drafts (tradeable via DraftPick objects).
- Order: reverse standings with a simple lottery (bottom-5 teams can jump to #1: 25/18/14/10/8%), playoff teams by elimination order.
- Prospect generation: 64+ prospects per class, names from nationality-weighted name pools (CAN/USA/SWE/FIN/RUS/CZE),
  age 18, overall 55-72, potential 68-96 skewed so ~3 franchise (90+ pot), ~10 top-6/top-4 (83+), rest mid.
  Position mix ~ 30 F / 22 D / 6 G per 64. Busts/steals: potential shown to user is a RANGE band (e.g. "Top-6 F"), actual number hidden.
- Drafted players go to `prospects` with a 3-year cheap ELC (capHit 0.95, RFA expiry).

## Trades (`src/engine/trades.ts`)

- Value model: player value = f(overall, age, potential, capHit, yearsLeft). Base curve exponential in overall
  (85 OVR ≈ 2x 80 OVR), young + high potential multiplies up to 2.5x, age 30+ decays, bad contract (capHit > value) subtracts.
  Pick value: R1 ≈ 70-OVR-prospect equivalent scaled by expected slot (use owner's current standing), R2 ≈ third of R1.
- AI accepts if `valueReceived >= valueGiven * 1.05` AND fits strategy (contenders want now-value, rebuilders want picks/prospects/U24)
  AND cap works both ways AND roster sizes stay legal. `verdict` strings: "insulting", "not close", "close — sweeten it", "accepted".
- `getAiTradeSuggestion`: builds a fair offer around a player the partner would move by strategy.

## Awards (`src/engine/awards.ts`) — computed at season end

Hart (most points, tiebreak +/-), Art Ross (points), Rocket Richard (goals), Norris (top D by points),
Vezina (best SV% among goalies with >= 41 starts... use >= 30 wins fallback), Calder (best points by age<=23 rookie flag: first NHL season).

## UI screens (`src/ui/`) — single-page, top tab nav, team-colored header

1. **TeamSelect** — 32 team cards (logo = colored circle w/ abbrev), shows team overall & cap space; "Continue save" if save exists.
2. **Dashboard** — record, division position, cap usage bar, next 5 games w/ opponent strength, news feed, sim buttons (Sim Day / Week / Month / To Deadline / To End), phase banner + CTA (e.g. "Playoffs started — Sim Round").
3. **Roster** — sortable table (name, pos, age, OVR, POT arrow, cap hit, years, expiry), row click → player card modal (ratings, contract, season + career stats); call up / send down; lines auto-picked (display only: L1-L4, P1-P3, G1-G2).
4. **Standings** — division tables + wildcard race, playoff cutline, click column sort.
5. **Leaders** — league top-20 points/goals/goalie tables; user team highlighted.
6. **Trades** — partner picker w/ AI "what they want" hint, two-column asset picker (players + picks), live evaluate verdict meter, execute; AI suggestion button.
7. **Playoffs** — bracket view with series scores, sim-round button.
8. **Offseason hub** — stepper UI walking awards → development report (arrows up/down per player) → re-sign list (asking price, offer sliders, sign/walk) → draft room (board, best available, your pick timer-less) → free agency (browse FAs, offer modal, day advance, signing ticker) → roster check.
9. **History** — past seasons table (cup winner, your finish, your record), awards history, franchise leaderboards (career points with your team).

Styling: dark theme, `src/styles.css`, CSS variables `--team` / `--team2` set from team colors. Clean tables,
compact density, no external fonts/images. Must look sharp — this is a game, not an admin panel.
OVR badges color-coded (90+ gold, 85+ green, 80+ teal, 75+ gray, <75 dim).

## Testing

`scripts/sim-test.ts` (run via `node --experimental-strip-types`): new game as TOR, loop: sim to end of season,
sim playoffs, run full offseason with AI-auto decisions for the user (re-sign anyone asking <= fair, draft best available,
sign FAs to fill roster) — 10 seasons. Assert: no exceptions; every team 82 GP each season; standings points sum
== 2 * games + OT bonus (just sanity: pts between 30 and 145); every team roster 20-23 and cap-legal each Oct;
a Cup winner exists each season; league scoring leader between 70 and 165 points; no NaN anywhere in stats.
Print a 10-season summary table.

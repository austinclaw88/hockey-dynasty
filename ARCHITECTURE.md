# Hockey Dynasty — Architecture

A browser-only NHL dynasty/franchise-mode manager (think EA NHL franchise mode **without** playable games).
The user picks one of the 32 real NHL teams with its real 2026-27 roster and real contracts, then manages it
for 10 seasons (2026-27 → 2035-36): simulate the schedule, make trades, re-sign players, sign free agents,
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
// data/faPool/draft2027 are threaded in by the caller (src/data/index.ts exports
// TEAM_DATA, FA_POOL, DRAFT_2027). draft2027 (data/draft-2027.json) seeds the
// FIRST in-game entry draft (June 2027); empty/absent => that draft is generated.
newGame(userTeam: string, data: TeamDataFile[], faPool?: FreeAgentPoolFile, draft2027?: DraftClassFile): GameState
// Dynasty FANTASY-draft mode: build the league, then EVERY team's roster players
// enter a 23-round snake draft (see "Fantasy draft" below). Prospects/picks/FA pool
// stay with their clubs. Core: newGameFantasyCore (data-free); browser barrel wraps
// it with the bundled data as newGameFantasy(userTeam).
newGameFantasy(userTeam: string, data?: TeamDataFile[], faPool?: FreeAgentPoolFile): GameState

// simulation (regular season + playoffs)
simDays(s: GameState, days: number): GameState          // plays all games in the next N calendar days
simToEndOfSeason(s: GameState): GameState
// Playoffs are played GAME-BY-GAME (each game simmed with the full game-sim
// machinery, box scores included). Playoff player stats accrue to a SEPARATE
// store — s.playoffStats — NOT s.stats, so the 82-game regular season (and every
// downstream consumer: awards, leaders, careers) never inflates past 82 GP. See
// "Playoff stats separation" below.
simPlayoffGame(s: GameState): GameState                 // one "playoff night": ONE game in every undecided series of the round; a call on a completed round seeds the next round; the Cup-clinching call enters the offseason
simPlayoffRound(s: GameState): GameState                // sims game-nights until the whole current round completes, then seeds the next round

// derived views (read-only helpers)
getStandings(s: GameState): { league: StandingsRow[]; byDivision: Record<Division, StandingsRow[]> }
getLeaders(s: GameState): { points: SeasonStatLine[]; goals: SeasonStatLine[]; assists: SeasonStatLine[]; goalies: SeasonStatLine[] } // top 20 each (assists tiebreak by points) — REGULAR SEASON only (s.stats)
// Postseason leaders from the separate s.playoffStats store (top 10 each); empty before/without a playoff run.
getPlayoffLeaders(s: GameState): { points: SeasonStatLine[]; goalies: SeasonStatLine[] }
// cap/space reported on the SAME basis the engine enforces: during 'offseason'
// cap = next season's cap and capYear = seasonYear+1; otherwise current season.
// `used` is COMMITTED cap in the offseason (helpers.committedCapUsed): expiring
// players still on the roster carry a dead 0-year hit that is NOT counted, so
// re-signing one below his old AAV correctly REDUCES space (the old teamCapUsed
// counted those dead hits and made space jump the wrong way). All offseason-phase
// cap math (re-sign, sign FA, offseason trades, callUp, roster fix) uses committed
// cap; in-season keeps teamCapUsed since no expired deals exist mid-season.
getCapUsage(s: GameState, team: string): { used: number; cap: number; space: number; capYear: number }
findPlayer(s: GameState, id: string): { player: Player; team?: string } | null

// lines — manual line management for the USER team (see Simulation model below).
// setUserLines validates ids against the user roster (invalid ids dropped to '');
// null clears back to full-auto. effectiveLines returns the resolved, all-slots-
// filled lineup (user lines honoured, others auto) the UI displays and the sim runs.
setUserLines(s: GameState, lines: LineAssignments | null): GameState
effectiveLines(s: GameState, team: string): LineAssignments

// offseason — call advanceOffseason() to move through steps in order:
// awards -> development -> resign -> draft -> freeAgency -> rosterCheck -> next season (phase 'regular')
advanceOffseason(s: GameState): GameState
// during 'resign': user decisions on own expiring contracts. Optional trailing
// `ntc` offers a no-trade clause (lowers the player's effective ask; the signed
// deal carries ntc: true). Extra term vs the ask also lowers the effective ask,
// fewer years raises it — see getSigningPreview.
resignPlayer(s: GameState, playerId: string, years: number, capHit: number, ntc?: boolean): { s: GameState; ok: boolean; reason?: string }
letWalk(s: GameState, playerId: string): GameState      // expiring player goes to FA pool
getResignAsking(s: GameState, playerId: string): { capHit: number; years: number }
// MID-SEASON extension (phase 'regular' only): re-up a USER roster player in the
// final year of his deal (contract.yearsLeft === 1). Acceptance uses the effective-
// ask machinery plus a ~3% loyalty discount; the new AAV applies IMMEDIATELY (single-
// AAV) and must fit the CURRENT season cap (teamCapUsed - oldHit + newHit <= currentCap).
// On success: { capHit: newAAV, yearsLeft: 1 + years, expiry by age at new expiry,
// ntc }. getSigningPreview handles this case too (roster player, yearsLeft 1, regular).
extendPlayer(s: GameState, playerId: string, years: number, capHit: number, ntc?: boolean): { s: GameState; ok: boolean; reason?: string }
// during 'draft': draft proceeds pick-by-pick; AI picks auto-advance until it's the user's pick
draftPlayer(s: GameState, playerId: string): GameState  // user makes their pick, then AI continues to next user pick
autoDraftPick(s: GameState): GameState                  // autodraft the user's current pick (best available by potential-weighted board value)
autoCompleteDraft(s: GameState): GameState              // autodraft ALL remaining user picks + let AI finish the round order
getDraftBoard(s: GameState): { onClock: string; pickNumber: number; available: Player[]; results: {pick:number; team:string; playerName:string}[] }
// during 'freeAgency': day-based; each advanceFreeAgencyDay, AI teams sign players.
// Optional trailing `ntc` behaves as in resignPlayer.
// signFreeAgent ALSO works during the REGULAR season: leftover UFAs stay signable
// all year (cap checked on capForPhase/capUsedForPhase — current cap in-season,
// next/committed in the offseason; roster max 23; contract yearsLeft INCLUDES the
// current season). RFAs whose rights are held (FreeAgent.rightsTeam set) are NOT
// signable this way — they require an offer sheet — and NOBODY signs during the
// playoffs (rejected). In-season asks also decay ~2%/week (floor 70%).
signFreeAgent(s: GameState, playerId: string, years: number, capHit: number, ntc?: boolean): { s: GameState; ok: boolean; reason?: string }
// OFFER SHEETS (offseason FA step): tender a rival team's qualified RFA. See the
// "Offer sheets" section below for the match/compensation model.
tenderOfferSheet(s: GameState, playerId: string, years: number, capHit: number): { s: GameState; ok: boolean; matched?: boolean; reason?: string }
respondToOfferSheet(s: GameState, sheetId: number, match: boolean): { s: GameState; ok: boolean; reason?: string }
// Live negotiation preview for the UI meter (pure). Works for pool FAs (via asking),
// offer-sheet targets (effective ask; NTC leverage ignored for sheets), and the
// user's own expiring players (via askingFor). In-season it applies the ask decay.
// Verdict is one of 'certain' | 'likely' | 'coin flip' | 'unlikely' | 'rejected'.
getSigningPreview(s: GameState, playerId: string, years: number, capHit: number, ntc: boolean): { effectiveAsk: number; verdict: SigningVerdict }
advanceFreeAgencyDay(s: GameState): GameState           // ~5 FA days total, then step is done

// dynasty fantasy draft (phase 'fantasyDraft' only) — mirrors the entry-draft flow
getFantasyBoard(s: GameState): { onClock: string; pickIndex: number; round: number; totalPicks: number; recent: { pick: number; team: string; playerName: string }[] }
fantasyPick(s: GameState, playerId: string): GameState  // user's pick (when on the clock), then AI auto-picks to the user's next turn
autoFantasyPick(s: GameState): GameState                // autodraft the user's current pick, then AI continues
autoCompleteFantasyDraft(s: GameState): GameState       // autodraft everything, build the schedule, enter 'regular'

// roster moves (any time)
callUp(s: GameState, playerId: string): { s: GameState; ok: boolean; reason?: string }     // prospect -> roster
sendDown(s: GameState, playerId: string): { s: GameState; ok: boolean; reason?: string }   // roster -> prospects (age<=25 & overall<=78 only)

// trades (regular season before day ~120 = deadline, and offseason freeAgency step)
// Cap legality for trades is enforced on capForPhase(s): offseason trades count
// against next season's cap, in-season trades against the current cap.
evaluateTrade(s: GameState, offer: TradeOffer): { accept: boolean; verdict: string; delta: number }
executeTrade(s: GameState, offer: TradeOffer): { s: GameState; ok: boolean; reason?: string }
getAiTradeSuggestion(s: GameState, partner: string): TradeOffer | null
// player-seeded suggestion: playerId on partner -> what user must PAY to get him;
// playerId on user -> what partner would GIVE for him. Null if NTC/untradeable/no fair package.
getAiTradeSuggestionFor(s: GameState, partner: string, playerId: string): TradeOffer | null

interface TradeOffer {
  from: string; to: string                 // team abbrevs; from = user
  fromPlayers: string[]; toPlayers: string[]   // player ids
  fromPicks: DraftPick[]; toPicks: DraftPick[]
}

// trade block — shop your own players; only user-team roster players may be added.
// Ids are auto-pruned when a player leaves the roster (traded / retired / sent down).
toggleTradeBlock(s: GameState, playerId: string): GameState

// incoming AI offers — GameState.pendingOffers (max 3, oldest dropped). AI teams
// generate offers for user players (~once/sim-week per interested team before the
// deadline, once per FA day in the offseason); interest is strongly boosted for
// trade-block players. Offers are always expressed from the USER's perspective
// (offer.from === userTeam) and auto-expire (>~14 days, deadline, season end) or
// when a referenced player leaves either roster.
respondToOffer(s: GameState, offerId: number, accept: boolean): { s: GameState; ok: boolean; reason?: string }

// persistence — loadGame is re-exported from withData (engine barrel) so a loaded
// save is re-hydrated with bundled static data (the real 2027 draft class) for
// legacy saves that predate it. persistence.ts itself stays data-free.
saveGame(s: GameState): void
loadGame(): GameState | null                            // barrel: withData.loadGame (hydrates static data)
hydrateStaticData(s: GameState): GameState              // re-attach DRAFT_2027 to a save when seasonYear <= 2027 and absent
hasSave(): boolean
deleteSave(): void
```

## Simulation model (engine internals — `src/engine/sim.ts`)

No play-by-play. Each game is resolved statistically:

0. **Lineup selection** (`effectiveLines(s, team)`): the ACTIVE lineup is 12 F / 6 D / starter+backup G.
   Every team is full-auto EXCEPT the user team when `s.userLines` is set: a valid manual slot entry (player on
   roster, healthy, right position GROUP — any F fills any F slot, D fills D, G fills G) is honoured wherever the
   user put it (a manual center on the wing stays there). Auto-fill is POSITION-AWARE: `forwards[line]` is
   `[LW, C, RW]`, so the C slot (index 1) draws the best remaining true center, LW (0) the best LW, RW (2) the
   best RW; lines fill L1-first so the top trio is the best of each position, and an off-position forward fills a
   slot only as a LAST resort (that position's pool exhausted). Defense pairs are `[LD, RD]` filled best-by-overall
   (unchanged pairing → ratings unaffected), then within a fully-auto pair the left-shot D takes LD and the
   right-shot D takes RD. `effectiveLines` returns the fully-resolved assignment (all slots filled, unfillable = '')
   that the UI shows and the sim drives.
1. **Team strength** from the effective lineup IN SLOT ORDER (so line placement, not raw overall, drives it):
   - `off = 0.65 * wAvg(top9 F overalls) + 0.35 * wAvg(top4 D overalls)` (weight top-3 F double)
   - `def = 0.55 * wAvg(top6 D) + 0.45 * wAvg(top12 F)`
   - `goalie = effective starter overall` (backup starts ~25% of games, tracked so goalie stats split)
2. **Expected goals**: league mean 3.05/team/game, scaled: `xg = 3.05 * 1.10^((off_A - def_B)/6) * 1.08^((78 - goalie_B)/6)`, clamp [1.4, 5.2]. Home team +4% xg.
3. Sample goals from Poisson. If tied after regulation, one team wins in OT/SO (60/40 OT vs SO, better team 55%).
4. **Attribution**: each goal assigned to a scorer on the winning-of-that-goal team weighted by
   `(overall - 55)^2` with forwards 4x D weight; 0-2 assists similarly. Each weight is multiplied by a
   per-skater factor = **production factor × line-slot usage multiplier** (cached per game, not per goal).
   The **usage multiplier** makes playing time real — folded into BOTH goal and assist weights:
   forwards L1 ×1.08 / L2 ×1.02 / L3 ×0.96 / L4 ×0.94; defense P1 ×1.04 / P2 ×1.0 / P3 ×0.96. Each group's
   multipliers average ≈1 so the aggregate F/D scoring balance (and league mean) is preserved — only the
   distribution shifts toward the top lines. (The values are tuned mild: the specified ×1.35/×1.3-scale
   constants over-concentrated scoring and broke the leader/best-D realism bands, since attribution feeds
   next season's form + development and the concentration compounds.) The **production factor = ageFactor ×
   formFactor**:
   - ageFactor: peak 21-31 ×1.0, 32-33 ×0.9, 34-35 ×0.78, 36-37 ×0.62, 38+ ×0.5, under-21 ×0.85.
   - formFactor: from the player's most recent archived season (`s.careers`, incl. real history), ppg-driven
     `clamp(0.75 + ppg*0.35, 0.8, 1.25)` with >= 20 GP last season; no data => 1.0.
   Forward base uses a soft knee above 90 OVR and D assist weight saturates at 85 OVR, so once the factors
   concentrate scoring onto in-form stars a single superstar/blueliner can't run past the NHL realism band.
   +/- and PIM lightly randomized. Goalie line gets the GA/SA (shots ~ 27-34) for SV% and GAA (the shootout
   decider is NOT charged to the goalie). Each `GoalEvent.period` is set: regulation goals ~31/34/35% across
   periods 1-3; an OT winner is the final scored goal and gets period 4; a shootout adds NO scored-goal event.
5. **Injuries**: per team-game ~3% chance a random player is injured 1-6 weeks (news item; auto next-man-up).

Roughly 1312 games/season; must sim a full season in well under a second.

## Season calendar

- 82 games/team generated round-robin-ish: 4 vs each division rival (32... just approximate: build a
  schedule where each team plays 82 with realistic mix; exact NHL formula not required, but every team
  must total exactly 82, home/away roughly balanced), spread over 185 days (Oct 8 → Apr 10 labels).
- Trade deadline at day 120 — after that, `executeTrade` rejects until offseason FA step.
- Playoffs: top 3 per division + 2 wildcards per conference, NHL bracket, best-of-7. Each series is
  played GAME-BY-GAME with the full game-sim machinery (`simPlayoffGameResult` in sim.ts → `playMatch`,
  the shared core behind regular-season `simGame`), so playoff games produce box scores (`GoalEvent`s) and
  player stats — BUT playoff attribution accrues to `s.playoffStats`, NOT `s.stats` (see "Playoff stats
  separation"). Home ice alternates 2-2-1-1-1 with the
  higher seed opening at home (games 1,2,5,7). Playoff ties always go to sudden-death OT — never a shootout —
  so `PlayoffGame.endType` is `'REG' | 'OT'`. Each game is appended to `PlayoffSeries.games`. `simPlayoffGame`
  plays ONE game per undecided series (a "playoff night"); `simPlayoffRound` loops nights until the round ends.
  A round completes → the next call (or `simPlayoffRound`) seeds the next round from consecutive winner pairs.
  Legacy saves without a `games` array don't crash (game index falls back to `highWins + lowWins`).

## Playoff stats separation (`s.stats` vs `s.playoffStats`)

- Regular-season and playoff player stats live in TWO stores, both keyed by playerId: `s.stats` (the 82-game
  season) and `s.playoffStats` (the postseason). `helpers.statStore(s)` returns `s.playoffStats` when
  `s.phase === 'playoffs'` (lazily initialised to `{}`), else `s.stats`; `ensureStat` writes through it, so ALL
  attribution in sim.ts (skater G/A/+-/PIM/GP and goalie lines) automatically lands in the right store with no
  per-call branching. `startPlayoffs` sets `s.playoffStats = {}`; `startNextSeason` clears both (`s.stats = {}`,
  `s.playoffStats = undefined`). This fixes the "93 GP" bug where playoff games pushed season/career totals past 82.
- Regular-season GP is additionally CLAMPED at 82 in `playMatch`: a player who changes teams mid-season (trade /
  in-season signing) can otherwise catch a new club's games-in-hand and drift past 82. Playoff GP is uncapped.
- Downstream consumers read `s.stats` ONLY: `getLeaders`, awards / `SeasonSummary` / `topScorers`, and the
  careers archive (`archiveCareerSeasons`) — so nothing double-counts and archived seasons never exceed 82 GP.
  `getPlayoffLeaders(s)` exposes the postseason store for the UI. Persistence: both fields are optional, so
  legacy saves load unchanged.

## Player development (`src/engine/development.ts`) — run each offseason

- age += 1 for everyone. Then adjust overall (seeded random within ranges, nudged by last season's points/60-ish performance vs expectation):
  - age <= 22: +1..+5 toward potential (never exceed potential)
  - 23-25: +0..+3 toward potential
  - 26-29: -1..+1 (potential = max(potential, overall))
  - 30-32: -2..0
  - 33-35: -3..-1
  - 36+: -5..-2
  - Goalies: shift all bands +2 years (develop later, last longer).
- **Playing time accelerates development**: for a skater aged <= 23 whose `potential > overall`, last season's
  usage biases the growth roll by ±1 (still capped at potential). Usage is read from `effectiveLines` of the
  team's END-of-season roster (before anyone is developed/removed): a **top-6 F or top-4 D** slot → **+1**
  (grows faster toward potential); **scratched / pressbox** (not in the 18-skater lineup) → **-1**; middle-of-
  lineup or prospects (not in the NHL lineup at all) → neutral. So giving a young player more minutes — e.g.
  promoting him to a top line via `setUserLines` — makes him reach his ceiling faster. Goalies unaffected.
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
- **Signing incentives (effective ask)**: acceptance is compared against an EFFECTIVE ask, not the raw ask.
  Offering a no-trade clause lowers it ~7% for established veterans (age 27+ AND 80+ OVR; ~2% for anyone else,
  who barely care); offering MORE years than asked lowers it ~3%/extra year (cap -6%); FEWER years raises it
  ~4%/missing year. An offered NTC carries onto the signed contract (`ntc: true`). `getSigningPreview` returns
  the effective ask + a verdict for a live UI negotiation meter. AI never offers NTCs to depth (it only re-signs
  85+ stars, carrying an existing ntc over).
- **Mid-season extensions (`src/engine/extensions.ts`)**: during phase 'regular', a USER roster player in the
  final year of his deal (`contract.yearsLeft === 1`) can be extended via `extendPlayer`. Acceptance reuses the
  effective-ask machinery with an extra ~3% loyalty discount (`extensionEffectiveAsk`/`LOYALTY_DISCOUNT` in
  contracts.ts, shared with `getSigningPreview`). The new AAV applies IMMEDIATELY and must fit the CURRENT
  season cap (`teamCapUsed - oldHit + newHit <= currentCap`). The new deal is `{ capHit: newAAV,
  yearsLeft: 1 + years, expiry by age at new expiry, ntc }`. AI teams run `aiMidSeasonExtensions` once per
  season in the day 40-80 window: each expiring 83+ OVR player they can afford is extended with 65% probability
  (news item), reducing offseason star churn while still leaving some stars to reach the resign step.
- **FA pool composition**: the pool is dominated by REAL players (the 35 seeded UFAs + anyone who walked). Only
  a handful of depth-tier fillers (<= 72 OVR) are generated — at most ~8 league-wide, and only when the pool is
  thin (< 25). rosterCheck "Journeyman" fills go straight onto AI rosters and never enter the FA pool.
- AI FA logic per FA day: each AI team with cap space + roster need signs best available fitting need; stars sign days 1-2. AI never signs a `rightsTeam` RFA outright (offer sheets only).
- Every roster must end offseason with 20-23 players, >= 2 G, >= 6 D, >= 12 F; AI auto-fixes with cheap generated depth signings ("Journeyman" pool) if short.
- **Leftover UFAs stay signable in-season (task 3)**: `startNextSeason` does NOT wipe the FA pool — it keeps
  unsigned real UFAs (dropping only retired players and generated `FA-`/`JMN-` fillers) so they persist through
  the year. `signFreeAgent` works in phase 'regular' (current-cap basis, roster max 23, `yearsLeft` includes the
  current season; rejected during the playoffs and for `rightsTeam` RFAs). Unsigned vets get hungrier: their
  effective ask decays ~2% per elapsed sim-week (`contracts.seasonAskDecay`, floor 70%). Each sim-week an AI team
  with an injury hole (>= 2 injured) and cap room may sign the best fitting leftover UFA
  (`maybeAiInSeasonSigning`), so the pool realistically thins.

## Offer sheets — restricted free agents (`src/engine/freeAgency.ts`)

The RFA flow (offseason 'resign' → 'freeAgency'):

- **Qualification (not auto-re-sign)**: in `prepareResign`, an AI team's expiring RFA (`contract.expiry === 'RFA'`
  or age < 27 at expiry) is NOT re-signed — it is pushed into `s.freeAgents` with `rightsTeam` = its club (asking
  computed as usual). Exception: a genuine franchise RFA (>= 87 OVR) re-signs outright (clubs never risk them).
  UFAs keep the old keep/walk logic. The user's own unsigned RFAs are likewise QUALIFIED (`rightsTeam = userTeam`)
  in `finalizeResign` rather than walking for free.
- **`signFreeAgent` rejects `rightsTeam` players** ("requires an offer sheet").
- **User tenders — `tenderOfferSheet(s, playerId, years, capHit)`**: the offer must be >= the player's effective
  ask (NTC leverage ignored for sheets); the user must have cap/roster room AND own the compensation picks. The
  rights team MATCHES with probability: base 80% if the deal fits under next cap, −8% per 5% overpay above the
  ask, floored at 25%; a deal they can't fit is never matched (0). Matched → player re-signs with the rights team
  at YOUR terms (`matched: true`). Unmatched → player joins the user at those terms and the user pays draft-pick
  **compensation** to the rights team (`matched: false`).
- **Compensation tiers by AAV** ($M): `< 1.5` none; `1.5–3` a 3rd; `3–4.5` a 2nd; `4.5–7` a 1st; `7–9` a 1st + a
  3rd; `> 9` a 1st + a 2nd + a 3rd. Picks are the payer's earliest-available owned picks of each round; if the
  user lacks a required round, the tender is rejected up front with a clear reason.
- **AI-to-AI & AI-to-user (`maybeAiOfferSheets`, ~35%/FA day → ~1-2 league-wide)**: an AI buyer with cap room,
  roster room, and the comp picks goes after a random qualified RFA. On another AI team's RFA it resolves at once
  (same match logic). On the USER's RFA it arrives as a `PendingOfferSheet` in `s.pendingSheets` (news item).
- **User responds — `respondToOfferSheet(s, sheetId, match)`**: match → re-sign at the sheet's terms (must fit
  cap/roster, else error); decline → the player joins the AI team and the USER receives the pick compensation
  from that team's picks (best-available fallback if it lacks the exact round). Unanswered sheets AUTO-DECLINE at
  FA end. Sheets whose player has left are pruned each FA day.
- **End of FA step (`finalizeOfferSheets`)**: unclaimed qualified RFAs auto-re-sign with their rights team at ask
  (they never walk for free); a rights team that can't fit one releases him as a true UFA (rosterCheck / next
  season handles). Both `s.pendingSheets` and `s.playoffStats` are transient and optional (legacy saves load fine).

## Draft (`src/engine/draft.ts`)

- 3 rounds (96 picks) — teams own their natural picks for all 10 drafts (tradeable via DraftPick objects).
  `roundOfSlot(orderLen, slot)` maps a draft slot to its round (order = reverse-standings order repeated 3x).
  Existing saves created before round 3 keep their 2-round pick INVENTORIES (fewer tradeable picks — acceptable);
  the draft still runs all 96 slots (untracked round-3 slots fall back to the original-team owner).
- Order: reverse standings with a simple lottery (bottom-5 teams can jump to #1: 25/18/14/10/8%), playoff teams by elimination order.
- Prospect generation: ~110 prospects per class (96 picks + margin), names from nationality-weighted name pools
  (CAN/USA/SWE/FIN/RUS/CZE), age 18. Potential distribution shape is UNCHANGED at the top (gems are NOT tripled):
  the first ~3 slots are franchise (90-96 pot), next ~10 top-6/top-4 (83-89), a mid tier (68-82) to slot 60, and a
  late-round depth tail (55-62 OVR / 70-80 pot). Busts/steals: potential shown to user is a RANGE band, actual number hidden.
- Drafted players go to `prospects` with a 3-year cheap ELC (capHit 0.95, RFA expiry).
- **Autodraft**: `autoDraftPick` makes the user's current pick with the best available prospect by potential-weighted
  board value (`potential*0.7 + overall*0.3`); `autoCompleteDraft` autodrafts every remaining user pick and lets the
  AI finish the round order until the draft step is complete. Both are no-ops outside the draft step.
- **Real 2027 class**: the FIRST in-game draft (June 2027) seeds from `data/draft-2027.json`. For a FRESH game it is
  threaded via `newGame` (the browser entry `withData.newGame` passes the bundled `DRAFT_2027`); for a LOADED save it
  is re-attached by `withData.hydrateStaticData`/`loadGame` (legacy saves predate the private field). Stored on a
  private engine field. Real players convert to age-18 prospects (contract null, hidden potential from the file,
  devLeague kept) anchoring the top of the board in file order (index 0 = best, e.g. Landon DuPont), topped up with
  generated prospects to the usual class size. Drafts 2028+ (and an empty file) are fully generated.

## Fantasy draft (`src/engine/fantasy.ts`)

Optional dynasty start mode ("draft anyone when you select a team"). `newGameFantasyCore` builds the league
exactly like `newGame`, then moves EVERY team's NHL **roster** players (keeping their real contracts) into
`s.fantasyDraft.pool`; **prospects, draft picks and the seeded FA pool stay with their original clubs**. It sets
`phase 'fantasyDraft'`, `mode 'fantasy'`, `fantasyDraft.rounds = 23`, `pickIndex = 0`, and a snake `order` = a
seeded random shuffle of the 32 teams (reverses each round). The schedule is cleared and (re)built when the
draft finishes.

- **Snake order / board**: `onClockTeam` maps `pickIndex` to a team (even rounds forward, odd rounds reversed).
  `getFantasyBoard` returns `{ onClock, pickIndex, round, totalPicks (=32×23=736), recent }`; `recent` is the last
  ~12 picks (tracked on `_fantasyResults`).
- **User pick**: `fantasyPick(s, playerId)` drafts for the user when on the clock, then AI auto-picks up to the
  user's next turn (mirrors the entry-draft flow). A user pick is BLOCKED only if it makes a legal completion
  impossible — too few remaining picks for the outstanding minimums, the remaining pool can't cover a needed
  position, or remaining-mandatory-slots × league-min would exceed remaining cap. `autoFantasyPick` /
  `autoCompleteFantasyDraft` autodraft.
- **AI drafting**: value = `overall*0.75 + potential*0.25`, adjusted for positional need toward a final
  **13F / 7D / 2G** (soft targets) with **hard minimums 12F / 6D / 2G** every team must reach. Two feasibility
  guards keep every roster legal without a post-draft fixup: (1) each team's picks never drop below its
  outstanding mandatory-minimum count (so it can always fill its own minimums), and (2) a beyond-minimum pick of a
  position is only allowed if the remaining pool would still cover every team's outstanding minimum at that
  position (the goalie supply is tight — 67 for 64 needed — so goalies are also hard-capped at 2/team). Cap
  legality is enforced per pick: `used + capHit + (remaining mandatory slots × league-min) <= currentCap`; players
  that would break it are skipped.
- **End**: the draft ends when the pool empties OR every team hits 23 (in practice the pool — ~688 players —
  empties first, so teams finish with 20-22 players). Any leftover pool players become free agents (rare). Then
  the schedule is built, `phase 'regular'`, a news item is posted, and the season proceeds identically —
  offseason / entry draft / free agency all work unchanged (`mode` stays 'fantasy' for flavor). All fantasy
  state is plain serializable data, so save/load works mid-draft.

## Trades (`src/engine/trades.ts`)

- Value model: player value = f(overall, age, potential, capHit, yearsLeft). Base curve exponential in overall
  (85 OVR ≈ 2x 80 OVR), young + high potential multiplies up to 2.5x, age 30+ decays, bad contract (capHit > value) subtracts.
  Pick value: R1 ≈ 70-OVR-prospect equivalent scaled by expected slot (use owner's current standing), R2 ≈ third of R1, R3 ≈ 40% of R2.
- AI accepts if `valueReceived >= valueGiven * 1.05` AND fits strategy (contenders want now-value, rebuilders want picks/prospects/U24)
  AND cap works both ways AND roster sizes stay legal. `verdict` strings: "insulting", "not close", "close — sweeten it", "accepted".
- **Realistic package sizing (task 4)**: real NHL trades are small (the biggest ever moved 13 pieces across BOTH
  sides), so `evaluateTrade`/`executeTrade` (and `respondToOffer`) enforce HARD LIMITS — max **6 assets per side**
  (players + prospects + picks combined) and max **11 total** across both sides — rejecting oversize offers with
  "Too many pieces — real trades max out around six a side." A side's package is valued with **diminishing
  returns**: assets are sorted by individual value and weighted `1.0, 0.9, 0.78, 0.62, 0.45, 0.3` (nth-best
  counts less), so a pile of depth can never equal a star. This applies consistently in `evaluateTrade`, AI
  acceptance, `getAiTradeSuggestion(For)`, `getTradeOptionsFor`, and incoming-offer generation (`packageValue`).
  AI-BUILT packages prefer COMPACT deals: biggest-piece-first assembly capped at **3 pieces per side** (4 only for
  true blockbusters — a target worth > ~2 first-rounders).
- `getAiTradeSuggestion`: builds a fair offer around a player the partner would move by strategy.
- `getAiTradeSuggestionFor(partner, playerId)`: same machinery, seeded on a specific player (user pays for a
  partner player / partner pays for a user player).
- **Prospects are tradeable** exactly like roster players: their ids work in `evaluateTrade`/`executeTrade`
  (moving prospect-to-prospect), `getTradeOptionsFor`, `getAiTradeSuggestionFor`, the trade block, and
  incoming-offer generation. Prospects carry ELCs but do NOT count against the 23-man roster or the cap on
  either side of a swap.
- **Trade block** (`GameState.tradeBlock`): user shops their own roster players OR prospects; boosts AI interest.
- **Incoming AI offers** (`GameState.pendingOffers`): AI teams initiate firm offers for user players during the
  season (before day 120) and during offseason free agency. Offers are net-fair to the user (value ratio ~1.0–1.15
  in the user's favour) and legal both ways; because the AI commits to them, `respondToOffer(accept)` executes the
  swap directly (bypassing the AI-acceptance threshold) after re-validating legality. Offers auto-expire.

## Awards (`src/engine/awards.ts`) — computed at season end

Hart (most points, tiebreak +/-), Art Ross (points), Rocket Richard (goals), Norris (top D by points),
Vezina (best SV% among goalies with >= 41 starts... use >= 30 wins fallback).
Calder (true rookies only): eligible = played >= 25 GP this season AND NO prior season with > 25 GP in
`s.careers` (which includes the real bundled history, so multi-year NHLers like Bedard/Demidov/Misa are
ineligible; a 2027 draftee's first NHL season qualifies). Awards are computed BEFORE the current season is
archived, so `s.careers` holds only prior seasons at award time. Pick the top-scoring eligible skater, else
the best eligible rookie goalie (>= 25 starts, best SV%), else no award.

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
a Cup winner exists each season; league scoring leader between 70 and 180 points (the upper bound is generous:
late-dynasty leaders climb as young stars develop and elite scorers now stay in the league); no NaN anywhere in
stats. It also shops a user player each season to exercise incoming AI offers, asserting every `pendingOffer`
references live assets and that no >=88 OVR player reaches free agency in the first 3 offseasons.
Print a 10-season summary table.

It also exercises the newer systems: **playoffs** are advanced partly via `simPlayoffGame` (game-by-game) then
finished by `simPlayoffRound`, asserting every finished series has 4-7 games, the winner exactly 4 wins, and each
game's box-score goal counts match its score per team; a **mid-season extension** of a user player in his final
year is verified (term grows by the offered years, cap stays legal); and a compact **fantasy-mode** exercise
(`newGameFantasyCore` → `autoCompleteFantasyDraft`) asserts every team ends 20-23 players / 2G+6D+12F / cap-legal,
then sims one full season + playoffs + offseason without failures.

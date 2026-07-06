# Hockey Dynasty

A browser-based NHL dynasty manager — think EA NHL franchise mode **without** playable games.
Pick one of the 32 real NHL teams with its real 2025-26 roster and real contracts, then run it
for 10 seasons (2025-26 → 2034-35): simulate the schedule, work the trade market, re-sign your
stars, sign free agents, draft generated prospect classes, and watch players develop, age, and retire.

No backend, no accounts — the whole game runs in your browser and auto-saves to `localStorage`.

## Play it

```bash
npm install
npm run dev        # open the printed localhost URL
```

Or build a single self-contained HTML file (game + all roster data, ~400 KB) you can open
anywhere or send to a friend:

```bash
npm run build:single   # -> dist-single/index.html
```

## How to play

1. **Pick a team** — cards show each club's overall strength and cap usage.
2. **Dashboard** — sim by day/week/month/to the trade deadline/to season end. Watch the news
   feed: injuries, AI-AI trades, milestones.
3. **Roster** — sortable table with EA-style OVR/potential badges, contracts, call-ups/send-downs.
4. **Trades** — pick a partner, build a package of players and picks, and read the AI's verdict
   ("insulting" → "accepted"). Contenders chase now-value; rebuilders want picks and kids.
   Deadline is in early March; the market reopens in the offseason.
5. **Playoffs** — 16-team NHL bracket, best-of-7, sim round by round.
6. **Offseason hub** — awards → development report (who grew, who declined) → re-sign your
   expiring contracts against their asking price → two-round draft with a lottery and hidden
   prospect potential → day-based free agency against 31 AI GMs → roster legality check.
7. Repeat for 10 seasons. Banners hang forever in the History tab.

## Data: rosters, ratings, contracts

The bundled dataset (`data/teams/*.json`) is a hand-checked snapshot of the real NHL at the
start of the 2025-26 season — 831 players with real cap hits, contract terms, and expiry status
(RFA/UFA), including summer-2025 movement (Marner to Vegas, Dobson to Montreal, Ehlers to
Carolina, Kaprizov's $17M extension, the Utah Mammoth, ...). Ratings are EA-style 50-99 overalls
assigned from real-world performance with league-wide anchors (McDavid 97). Run
`npm run validate-data` to check any edits against the roster/cap rules.

To refresh rosters from live data, run `node scripts/fetch-rosters.mjs` on a machine with
normal internet access — it pulls current rosters from the NHL's public API and maps recent
stats to ratings, preserving the bundled contract data (the NHL API doesn't expose salaries;
cross-check contract edits against [PuckPedia](https://puckpedia.com)).

## Engine

The simulation engine (`src/engine/`) is pure TypeScript with no React or DOM
dependencies (except a `localStorage`-guarded `persistence.ts`). Every public
API function takes a `GameState` and returns a brand-new one — the input is
never mutated. All randomness flows through a single seeded mulberry32 generator
whose state is stored in `GameState.rngState`, so a save replays identically and
`Math.random()` is never used. Games are resolved statistically rather than
play-by-play: each team's active lineup (best healthy 12F/6D/1G) yields offense
and defense ratings, those feed an expected-goals model (league mean ~3.05/game,
scaled by the rating gap and the opposing goalie, home-ice bonus, clamped), and
goals are sampled from a Poisson distribution. Every goal is attributed to a
scorer and up to two assisters weighted by `(overall-55)^2` (forwards favored
over defensemen), goalies accrue win/loss/SV%/GAA lines, and roughly 3% of
team-games produce a multi-week injury. A full 82-game, 1312-game season sims in
well under a second.

Player ratings are EA-style `overall` (current ability) and `potential`
(ceiling). Each offseason, `development.ts` ages every player and nudges their
overall within age-banded ranges — young players climb toward their potential,
prime players hold, and veterans decline — with a small bump or ding based on
how their scoring compared to expectation. Goalies develop later and last longer
(bands shifted +2 years). Players then retire probabilistically by age and
rating. The offseason proceeds in fixed order — awards → development → re-sign
your expiring players → draft (two rounds, weighted lottery, a generated
prospect class with nationality-weighted names and hidden bust/steal potential)
→ free agency (day-based, with AI teams signing to fill needs) → roster/cap
legality check — before the next season's schedule and salary cap roll in. Cap
compliance (using the real announced caps: $95.5M in 2025-26 rising to $113.5M
in 2027-28, then ~5%/yr) is enforced on every user action, and AI teams patch
illegal rosters with generated journeyman depth.

`node --experimental-strip-types scripts/sim-test.ts` runs a headless 10-season
dynasty and asserts league-wide invariants (82 GP everywhere, legal rosters and
caps every October, sane scoring leaders, a Cup winner every June, no NaNs).

## Development

```bash
npm run dev            # Vite dev server
npm run typecheck      # strict TS, zero errors expected
npm run validate-data  # roster/cap/rating sanity for data/teams/*.json
npm run sim-test       # headless 10-season soak test
npm run build          # production build -> dist/
npm run build:single   # self-contained single file -> dist-single/index.html
```

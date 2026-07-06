# Data spec — `data/teams/<ABBREV>.json`

One file per team, shape `TeamDataFile` from `src/types.ts`. This is a snapshot of the REAL NHL as of
**July 6, 2026** — after the 2025-26 season, the 2026 trade deadline, the 2026 Stanley Cup playoffs,
the 2026 entry draft (late June), and the first five days of 2026 free agency (opened July 1).
The dynasty starts with the 2026-27 season. Accuracy matters: verify against current web sources.

```json
{
  "info": { "abbrev": "TOR", "city": "Toronto", "name": "Maple Leafs", "conference": "East",
            "division": "Atlantic", "color": "#00205B", "colorSecondary": "#FFFFFF" },
  "roster": [
    { "id": "TOR-matthews", "name": "Auston Matthews", "pos": "C", "age": 29, "shoots": "L",
      "overall": 94, "potential": 94, "nationality": "USA",
      "contract": { "capHit": 13.25, "yearsLeft": 2, "expiry": "UFA", "ntc": true } }
  ],
  "prospects": [
    { "id": "TOR-cowan", "name": "Easton Cowan", "pos": "LW", "age": 21, "shoots": "L",
      "overall": 74, "potential": 87, "nationality": "CAN", "devLeague": "AHL",
      "contract": { "capHit": 0.895, "yearsLeft": 2, "expiry": "RFA" } }
  ]
}
```

## Rules

- `id` = `<ABBREV>-<lastname-lowercase>` (dedupe with a digit suffix if needed). Must be globally unique.
- **Roster: 21-23 players** with exactly: 12-14 F, 6-8 D, 2-3 G — the team's projected 2026-27
  opening roster as known on July 6, 2026. Every roster player has a non-null contract.
- **Prospects: 6-14 players** — the team's REAL prospect pool, accurate down to the NCAA level:
  drafted college players whose rights the team holds, CHL/junior picks, European loans, and AHL
  farmhands. Include the team's 2026 draft class (at least rounds 1-2, plus notable later picks).
  Every prospect gets `devLeague`: one of `'NCAA' | 'CHL' | 'AHL' | 'SHL' | 'Liiga' | 'KHL' | 'Czechia' | 'NL' | 'USHL' | 'Europe'`.
  For engine simplicity every prospect still carries an ELC-style contract (capHit 0.775-0.975,
  yearsLeft 1-3, expiry RFA) even if unsigned in reality.
- `age` = age in years as of **Oct 1, 2026** (integer).
- `yearsLeft` = seasons remaining INCLUDING 2026-27. A deal running through 2027-28 → 2.
  Deals signed July 2026 count from 2026-27 (an 8-year July signing → 8).
- `expiry`: RFA if the player will be under 27 at expiry, else UFA.
- `ntc: true` only for real full no-move/no-trade clauses.
- `capHit` in $M, real AAV. Team roster total must land between $80M and $104M (2026-27 cap = $104M).
- Reflect ALL of: 2025-26 in-season trades and the March 2026 deadline; 2026 offseason trades and
  draft-day moves; July 2026 UFA/RFA signings and offer sheets; signed extensions that kick in
  for 2026-27 (use the new AAV); retirements (e.g. do NOT include retired players); the 2026 draft.
- Where a depth player's exact new AAV is unverifiable, use a realistic value and note it.

## Ratings

Same EA-style anchors as before (league avg roster player ≈ 79; McDavid 97; clear franchise stars
90+; All-Star tier 87-89; strong top-6/top-4 83-86; middle-six 79-82; bottom-six 75-78; fringe 70-74),
but UPDATED for 2025-26 performance: breakouts move up, decliners move down. `potential` == overall
for age 27+, realistic ceiling for younger players. 2026 first-overall-type prospects: overall 60-80,
potential up to 96.

## Team file assignments

- Atlantic: BOS, BUF, DET, FLA, MTL, OTT, TBL, TOR
- Metropolitan: CAR, CBJ, NJD, NYI, NYR, PHI, PIT, WSH
- Central: CHI, COL, DAL, MIN, NSH, STL, UTA, WPG   (UTA = Utah Mammoth)
- Pacific: ANA, CGY, EDM, LAK, SJS, SEA, VAN, VGK

Validate with `npm run validate-data`.

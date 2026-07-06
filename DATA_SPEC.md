# Data spec — `data/teams/<ABBREV>.json`

One file per team, shape `TeamDataFile` from `src/types.ts`. This is a snapshot of the REAL NHL as of the
start of the 2025-26 season (October 2025). Accuracy matters: real players, real teams, real contract
cap hits and remaining terms as signed in reality. Use your knowledge of the league through the 2025-26 season.

```json
{
  "info": { "abbrev": "TOR", "city": "Toronto", "name": "Maple Leafs", "conference": "East",
            "division": "Atlantic", "color": "#00205B", "colorSecondary": "#FFFFFF" },
  "roster": [
    { "id": "TOR-matthews", "name": "Auston Matthews", "pos": "C", "age": 28, "shoots": "L",
      "overall": 94, "potential": 94, "nationality": "USA",
      "contract": { "capHit": 13.25, "yearsLeft": 3, "expiry": "UFA", "ntc": true } }
  ],
  "prospects": [
    { "id": "TOR-danford", "name": "Ben Danford", "pos": "D", "age": 19, "shoots": "R",
      "overall": 62, "potential": 82, "nationality": "CAN",
      "contract": { "capHit": 0.918, "yearsLeft": 3, "expiry": "RFA" } }
  ]
}
```

## Rules

- `id` = `<ABBREV>-<lastname-lowercase>` (dedupe with a digit suffix if needed). Must be globally unique.
- **Roster: 21-23 players** with exactly: 12-14 F (mix of C/LW/RW), 6-8 D, 2-3 G. Use the team's real
  opening-night-ish 2025-26 roster. Every roster player has a non-null contract.
- **Prospects: 3-6 players** — the team's real notable prospects/recent draft picks not on the NHL roster.
  ELC contracts (capHit 0.775-0.975, yearsLeft 1-3, expiry RFA).
- `age` = age as of Oct 1, 2025 (integer).
- `yearsLeft` = seasons remaining INCLUDING 2025-26. E.g. a deal running through 2027-28 → 3.
- `expiry`: RFA if the player will be under 27 (and < 7 accrued seasons — just use age < 27 at expiry) else UFA.
- `ntc: true` only for players with real full no-move/no-trade clauses (stars on big deals).
- `capHit` in $M, real AAV (e.g. 13.25 for Matthews, 14.0 for Draisaitl, 0.775-0.95 league min).
  Team total roster cap hits must land between $78M and $95.5M (2025-26 cap = $95.5M).
- Do NOT include: players traded away before Oct 2025, retired players. If unsure of a depth player's exact
  cap hit, use a realistic value (league-min 0.775-1.0 for 4th liners, 1-3 for middle six, etc.).

## Overall rating anchors (EA NHL style, be consistent league-wide)

- 97: McDavid.
- 95-96: MacKinnon, Kucherov, Draisaitl.
- 93-94: Makar, Matthews, Pastrnak, Hellebuyck, Barkov, Hughes (Q), Shesterkin.
- 90-92: clear franchise stars (Point, Rantanen, Hedman, Fox, Josi, Kaprizov, Panarin, Pettersson, Marner,
  Robertson, Hyman-tier NO — Hyman is 87. Think top-15 at their position).
- 87-89: All-Star tier — elite 1st liners / #1 D / top starters (Nugent-Hopkins, Nylander is 90, Tkachuks 90-91,
  Bouchard 89, Sorokin 90, Saros 90, Vasilevskiy 91).
- 83-86: strong top-6 F / top-4 D / good starters.
- 79-82: middle-six F / #4-5 D / solid backup or 1B goalie.
- 75-78: bottom-six regular / #6-7 D / backup.
- 70-74: 13th forward, depth D, third goalie.
- Use judgment from real 2024-25 + early 2025-26 performance. League average roster player ≈ 79.
- `potential`: == overall for age 27+. For younger players, realistic ceiling (Bedard 88 OVR... no — Bedard ~86 OVR
  with 94 potential; Celebrini ~85 OVR / 95 potential; Fantilli 84/91). Potential must be >= overall.

## Team file assignments

- Atlantic: BOS, BUF, DET, FLA, MTL, OTT, TBL, TOR
- Metropolitan: CAR, CBJ, NJD, NYI, NYR, PHI, PIT, WSH
- Central: CHI, COL, DAL, MIN, NSH, STL, UTA, WPG   (UTA = Utah Mammoth)
- Pacific: ANA, CGY, EDM, LAK, SJS, SEA, VAN, VGK

Validate with `npm run validate-data` (checks structure, counts, cap totals, id uniqueness, rating sanity).

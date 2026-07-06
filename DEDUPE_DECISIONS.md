# Cross-division dedupe decisions (July 2026 snapshot integration)

Each duplicated player below appears on two teams. KEEP on the listed team, REMOVE from the other.
After all removals, repair every touched team to stay legal per validator rules:
roster 21-23 with 12-14 F / 6-8 D / 2-3 G, cap total $80-104M, prospects 6-14, all ids unique.

Repair principles, in order of preference:
1. Promote a REAL prospect already in that team's file (keep their ELC; delete from prospects).
2. Add a REAL currently-unsigned player (our data's own UFA leftovers: Patrick Kane, Vladimir Tarasenko,
   Anthony Mantha, Jeff Skinner, Ryan Suter, Jacob Trouba is taken, John Klingberg, Philipp Kurashev,
   James van Riemsdyk...) at a plausible 1-2yr deal — but never the same player on two teams.
3. Only as a last resort, nudge AAVs that the research agents flagged as ESTIMATES (never
   well-sourced real contracts) to clear the $80M floor.
Document every repair in your final report.

## Decisions

1. Ivan Ivan — KEEP BOS (traded from COL for Lysell, well-sourced), REMOVE COL.
2. Jason Dickinson — KEEP EDM (researched UFA signing), REMOVE CHI.
3. Brett Kulak — KEEP COL (researched UFA signing), REMOVE EDM.
4. Alexander Petrovic — KEEP DAL, REMOVE FLA (FLA has 8 D and stays legal; DAL would drop to 5 D).
5. Maxim Shabanov — KEEP MIN (researched signing), REMOVE NYI.
6. Maxim Tsyplakov — KEEP NYI, REMOVE CGY (Pacific agent flagged its own claim low-confidence).
7. Joe Veleno — KEEP NYR (researched), REMOVE CHI.
8. Nick Jensen — KEEP ANA (researched 2x$2.25M), REMOVE OTT.
9. Andrei Kuzmenko — KEEP PIT (researched arrival), REMOVE LAK (also relieves LAK's tight cap).
10. Connor Clifton — KEEP BOS (well-sourced 2x$2.25M UFA), REMOVE PIT.
11. Jaden Schwartz — KEEP COL (researched UFA signing), REMOVE SEA.
12. William Eklund — KEEP OTT (trade for #9 pick, nhl.com-sourced), REMOVE SJS (roster).
13. Kasper Halttunen — KEEP OTT (same trade), REMOVE SJS (prospects).
14. Ilya Mikheyev — KEEP TBL (researched 4x$3.85M signing), REMOVE CHI.
15. Colton Sissons — KEEP TOR (researched signing), REMOVE NSH.
16. Vladislav Kolyachonok — KEEP UTA, REMOVE NJD (UTA would drop to 5 D otherwise).
17. Nils Hoglander — KEEP NSH (researched arrival), REMOVE VAN.
18. Luke Schenn — KEEP VAN (researched arrival), REMOVE NSH.
19. Elias Pettersson x2 on VAN — LEGITIMATE (two real players: the center and the defenseman
    "D-Petey"). Keep BOTH. If their ids collide, suffix the defenseman's id.
20. Mario Ferraro — KEEP WPG (researched arrival), REMOVE SJS.
21. Ville Heinola — KEEP VGK, REMOVE WPG (VGK would drop to 5 D otherwise; WPG can promote
    D prospect Elias Salomonsson to stay at 21 skaters / 7 D).
22. Vincent Desharnais — KEEP WSH (researched signing), REMOVE SJS.

## Known repair hot-spots (pre-computed)

- CHI loses Dickinson, Veleno, Mikheyev (3 F): roster 23→20, F 13→10. Re-add 2-3 real F:
  Philipp Kurashev (unsigned ex-Hawk, 1yr ~$1.5M) is a natural; promote a real CHI F prospect
  (e.g. Oliver Moore or Sacha Boisvert if in file) for the rest. Cap has room (~$103M before cuts).
- SJS loses Eklund (F), Ferraro (D), Desharnais (D), Halttunen (prospect): roster 22→19, D 7→5,
  cap ~$73.6M. Repairs: promote real AHL prospects (e.g. Collin Graf F, Luca Cagnoni D if present),
  sign Vladimir Tarasenko (1yr ~$3.5M) and/or John Klingberg (1yr ~$2M), and top up prospects
  back to >= 6 with REAL Sharks prospects (Leo Sahlin Wallenius, Carson Wetsch, Igor Chernyshov...).
  End state must be >= $80M and 21+ players.
- NSH loses Sissons (F) + Schenn (D): promote real NSH prospects (Joakim Kemell F is NHL-ready;
  a D like Tanner Molendyk if present) and/or add a cheap real vet D. Keep prospects >= 6.
- PIT loses Clifton: cap likely dips below $80M — nudge PIT's ESTIMATED deals (van Riemsdyk,
  Lapierre — flagged as estimates by the Metro agent) up modestly to clear the floor.
- CGY loses Tsyplakov: if cap dips below $80M, nudge CGY's flagged floor-filler deals
  (Mantha/Skinner/Suter were the Pacific agent's assumptions) up modestly.
- VAN loses Hoglander: cap likely ~$77.5M — nudge VAN's ESTIMATED deals (Evander Kane was an
  assumption at $4.5M; Cotter estimate) up modestly to clear the floor.
- NYI loses Shabanov, OTT loses Jensen, SEA loses Schwartz, LAK loses Kuzmenko, NJD loses
  Kolyachonok, FLA loses Petrovic, WPG loses Heinola (promote Salomonsson), EDM loses Kulak,
  COL loses Ivan: verify each stays within all bounds; repair per the principles if not.

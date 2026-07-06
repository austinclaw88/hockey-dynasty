// ============================================================
// ENGINE API REFERENCE — for the UI agent only.
// This file intentionally re-exports NOTHING. It is a frozen copy
// of the "Engine public API" section of ARCHITECTURE.md so the UI
// can be written against exact signatures while the real
// src/engine/index.ts is built concurrently.
//
// Import the REAL symbols from '../engine' (which does not exist yet
// — `cannot find module '../engine'` during typecheck is expected).
// ============================================================
//
// // setup
// newGame(userTeam: string): GameState
//
// // simulation
// simDays(s: GameState, days: number): GameState
// simToEndOfSeason(s: GameState): GameState
// simPlayoffRound(s: GameState): GameState
//
// // derived views
// getStandings(s: GameState): { league: StandingsRow[]; byDivision: Record<Division, StandingsRow[]> }
// getLeaders(s: GameState): { points: SeasonStatLine[]; goals: SeasonStatLine[]; goalies: SeasonStatLine[] }
// getCapUsage(s: GameState, team: string): { used: number; cap: number; space: number }
// findPlayer(s: GameState, id: string): { player: Player; team?: string } | null
//
// // offseason
// advanceOffseason(s: GameState): GameState
// resignPlayer(s: GameState, playerId: string, years: number, capHit: number): { s: GameState; ok: boolean; reason?: string }
// letWalk(s: GameState, playerId: string): GameState
// getResignAsking(s: GameState, playerId: string): { capHit: number; years: number }
// draftPlayer(s: GameState, playerId: string): GameState
// getDraftBoard(s: GameState): { onClock: string; pickNumber: number; available: Player[]; results: {pick:number; team:string; playerName:string}[] }
// signFreeAgent(s: GameState, playerId: string, years: number, capHit: number): { s: GameState; ok: boolean; reason?: string }
// advanceFreeAgencyDay(s: GameState): GameState
//
// // roster moves
// callUp(s: GameState, playerId: string): { s: GameState; ok: boolean; reason?: string }
// sendDown(s: GameState, playerId: string): { s: GameState; ok: boolean; reason?: string }
//
// // trades
// evaluateTrade(s: GameState, offer: TradeOffer): { accept: boolean; verdict: string; delta: number }
// executeTrade(s: GameState, offer: TradeOffer): { s: GameState; ok: boolean; reason?: string }
// getAiTradeSuggestion(s: GameState, partner: string): TradeOffer | null
//
// interface TradeOffer {
//   from: string; to: string
//   fromPlayers: string[]; toPlayers: string[]
//   fromPicks: DraftPick[]; toPicks: DraftPick[]
// }
//
// // persistence
// saveGame(s: GameState): void
// loadGame(): GameState | null
// hasSave(): boolean
// deleteSave(): void

export {}

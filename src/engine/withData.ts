// The browser entry's newGame: defaults the team data to the bundled snapshot.
// Kept separate so api.ts stays free of the data-file import chain (which lets
// the headless sim-test import the engine without the 32 JSON files present).
import type { GameState, TeamDataFile } from '../types.ts'
import { newGame as newGameCore } from './newGame.ts'
import { TEAM_DATA } from '../data/index.ts'

export function newGame(userTeam: string, data: TeamDataFile[] = TEAM_DATA): GameState {
  return newGameCore(userTeam, data)
}

// The browser entry's newGame: defaults the team data to the bundled snapshot.
// Kept separate so api.ts stays free of the data-file import chain (which lets
// the headless sim-test import the engine without the 32 JSON files present).
import type { GameState, TeamDataFile, FreeAgentPoolFile } from '../types.ts'
import { newGame as newGameCore } from './newGame.ts'
import { TEAM_DATA, FA_POOL } from '../data/index.ts'

export function newGame(userTeam: string, data: TeamDataFile[] = TEAM_DATA, faPool: FreeAgentPoolFile = FA_POOL): GameState {
  return newGameCore(userTeam, data, faPool)
}

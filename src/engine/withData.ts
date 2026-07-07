// The browser entry's newGame: defaults the team data to the bundled snapshot.
// Kept separate so api.ts / persistence.ts stay free of the data-file import
// chain (which lets the headless sim-test import the engine without the 32 JSON
// files present). The engine CORE stays data-free — only this module may reach
// into src/data, so re-attaching bundled static data to a save happens HERE.
import type { GameState, TeamDataFile, FreeAgentPoolFile } from '../types.ts'
import { newGame as newGameCore, newGameFantasyCore } from './newGame.ts'
import { loadGame as loadGameCore } from './persistence.ts'
import { ext } from './helpers.ts'
import { TEAM_DATA, FA_POOL, DRAFT_2027 } from '../data/index.ts'

export function newGame(userTeam: string, data: TeamDataFile[] = TEAM_DATA, faPool: FreeAgentPoolFile = FA_POOL): GameState {
  // Thread the real projected 2027 draft class so the FIRST in-game entry draft
  // seeds from it (Landon DuPont et al). Without this the 2027 draft generated a
  // fully fictional class — the fresh-game DuPont bug.
  return newGameCore(userTeam, data, faPool, DRAFT_2027)
}

/** Dynasty FANTASY draft mode with the bundled data (browser entry). Every NHL
 *  player enters a 23-round snake draft; see engine/newGame.newGameFantasyCore. */
export function newGameFantasy(userTeam: string, data: TeamDataFile[] = TEAM_DATA, faPool: FreeAgentPoolFile = FA_POOL): GameState {
  return newGameFantasyCore(userTeam, data, faPool, DRAFT_2027)
}

/** Re-attach bundled static data (the real 2027 draft class) to a loaded save.
 *  Games saved before the DRAFT_2027 feature carry no `_draft2027`, so their
 *  2027 draft would otherwise be fully fictional. Idempotent; only touches saves
 *  that still have a 2027 draft ahead of them and lack the field. */
export function hydrateStaticData(s: GameState): GameState {
  if (s.seasonYear <= 2027 && !ext(s)._draft2027 && DRAFT_2027.players.length > 0) {
    ext(s)._draft2027 = DRAFT_2027
  }
  // Legacy saves: build the name registry from everyone still findable.
  if (!s.names) {
    s.names = {}
    for (const t of Object.values(s.teams)) {
      for (const p of [...t.roster, ...t.prospects]) s.names[p.id] = p.name
    }
    for (const f of s.freeAgents) s.names[f.id] = f.name
    for (const d of s.draftClass) s.names[d.id] = d.name
  }
  // One-time repair for saves created before playoff stats were separated:
  // regular-season lines (current + archived careers) had playoff GP baked in.
  // Clamp GP to 82; merged playoff points can't be un-mixed retroactively.
  for (const line of Object.values(s.stats)) {
    if (line.gp > 82) line.gp = 82
  }
  for (const seasons of Object.values(s.careers ?? {})) {
    for (const c of seasons) if (c.gp > 82) c.gp = 82
  }
  return s
}

/** Load a save through the withData layer so bundled static data is re-attached.
 *  The UI imports loadGame from the engine barrel, which re-exports THIS. */
export function loadGame(): GameState | null {
  const s = loadGameCore()
  return s ? hydrateStaticData(s) : null
}

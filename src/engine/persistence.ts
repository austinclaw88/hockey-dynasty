// localStorage persistence. Guarded so the engine also runs under Node scripts.
import type { GameState } from '../types.ts'

const KEY = 'hockey-dynasty-save'

function hasStorage(): boolean {
  // In sandboxed iframes merely touching localStorage can throw SecurityError.
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null
  } catch {
    return false
  }
}

export function saveGame(s: GameState): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Quota or serialization failure — ignore (autosave is best-effort).
  }
}

export function loadGame(): GameState | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GameState
    // Migrate old saves that predate the career-history archive.
    if (!parsed.careers) parsed.careers = {}
    return parsed
  } catch {
    return null
  }
}

export function hasSave(): boolean {
  if (!hasStorage()) return false
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}

export function deleteSave(): void {
  if (!hasStorage()) return
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

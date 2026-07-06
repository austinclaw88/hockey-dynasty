// App-level UI plumbing shared across screens: a global toast queue, a
// read-only team viewer, and a "start a trade" intent that jumps to the Trade
// Machine with a partner (and optionally a pre-filled offer) selected.
import { createContext, useContext } from 'react'
import type { Player } from '../types'
import type { TradeOffer } from '../engine'

export type ToastKind = 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

/** A request to open the Trade Machine, optionally pre-filled. */
export interface TradeIntent {
  /** Bumped on every request so identical partners re-trigger the effect. */
  nonce: number
  partner: string
  offer?: TradeOffer
}

export interface UIContextValue {
  /** Queue a bottom-right toast. */
  pushToast: (kind: ToastKind, text: string) => void
  /** Open the read-only team viewer for a team abbrev. */
  openTeam: (abbrev: string) => void
  /** Jump to the Trades tab with `partner` selected (and optional pre-filled offer). */
  startTrade: (partner: string, offer?: TradeOffer) => void
  /**
   * Open the player card (with Career table) from anywhere. Pass a player id
   * (resolved via findPlayer) or a Player object directly; `team` optionally
   * pins which team's colors/context to show.
   */
  openPlayer: (idOrPlayer: string | Player, team?: string) => void
  /** Open the "What would it take?" modal for an away-team player. */
  whatWouldItTake: (partner: string, playerId: string) => void
}

export const UIContext = createContext<UIContextValue>({
  pushToast: () => {},
  openTeam: () => {},
  startTrade: () => {},
  openPlayer: () => {},
  whatWouldItTake: () => {},
})

export function useUI(): UIContextValue {
  return useContext(UIContext)
}

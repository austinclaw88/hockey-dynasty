import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameState, Player } from './types'
import type { TradeOffer } from './engine'
import { newGame, loadGame, saveGame, hasSave, deleteSave, getStandings, findPlayer } from './engine'
import { Header } from './ui/Header'
import { TabNav } from './ui/TabNav'
import type { TabKey, TabDef } from './ui/TabNav'
import { TeamSelect } from './ui/TeamSelect'
import { Dashboard } from './ui/Dashboard'
import { Roster } from './ui/Roster'
import { Standings } from './ui/Standings'
import { Leaders } from './ui/Leaders'
import { Trades } from './ui/Trades'
import { Playoffs } from './ui/Playoffs'
import { OffseasonHub } from './ui/OffseasonHub'
import type { DevSnapshot } from './ui/OffseasonHub'
import { History } from './ui/History'
import { ToastViewport } from './ui/components'
import { TeamViewer } from './ui/TeamViewer'
import { PlayerModal } from './ui/PlayerModal'
import { WhatWouldItTakeModal } from './ui/WhatWouldItTake'
import { UIContext, type Toast, type ToastKind, type TradeIntent } from './ui/uiContext'

export default function App() {
  const [state, setState] = useState<GameState | null>(() => (hasSave() ? loadGame() : null))
  const [tab, setTab] = useState<TabKey>('dashboard')
  const [devSnap, setDevSnap] = useState<DevSnapshot>({})
  const prevPhase = useRef<string | null>(state?.phase ?? null)

  // ---- Global UI: toasts, team viewer, trade intent ----
  const [toasts, setToasts] = useState<Toast[]>([])
  const [viewTeam, setViewTeam] = useState<string | null>(null)
  const [tradeIntent, setTradeIntent] = useState<TradeIntent | null>(null)
  const [viewPlayer, setViewPlayer] = useState<{ player: Player; team?: string } | null>(null)
  const [wwit, setWwit] = useState<{ partner: string; playerId: string } | null>(null)
  const toastId = useRef(0)
  const nonce = useRef(0)

  const dismissToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback(
    (kind: ToastKind, text: string) => {
      const id = ++toastId.current
      setToasts((ts) => [...ts, { id, kind, text }])
      window.setTimeout(() => dismissToast(id), 3500)
    },
    [dismissToast],
  )

  const openTeam = useCallback((abbrev: string) => setViewTeam(abbrev), [])

  const startTrade = useCallback((partner: string, offer?: TradeOffer) => {
    setTradeIntent({ nonce: ++nonce.current, partner, offer })
    setViewTeam(null)
    setViewPlayer(null)
    setWwit(null)
    setTab('trades')
  }, [])

  const whatWouldItTake = useCallback((partner: string, playerId: string) => {
    setWwit({ partner, playerId })
  }, [])

  // Auto-save after every state change.
  useEffect(() => {
    if (state) saveGame(state)
  }, [state])

  // Phase-aware auto tab switching.
  useEffect(() => {
    if (!state) return
    const phase = state.phase
    if (phase !== prevPhase.current) {
      if (phase === 'playoffs') setTab('playoffs')
      else if (phase === 'offseason') setTab('offseason')
      else if (phase === 'over') setTab('history')
      else if (phase === 'regular') setTab('dashboard')
      prevPhase.current = phase
    }
  }, [state])

  function apply(next: GameState) {
    setState(next)
  }

  function startNewGame(abbrev: string) {
    const g = newGame(abbrev)
    setDevSnap({})
    prevPhase.current = g.phase
    setTab('dashboard')
    setState(g)
  }

  function abandon() {
    deleteSave()
    setState(null)
    setTab('dashboard')
  }

  if (!state) {
    return (
      <TeamSelect
        onSelect={startNewGame}
        onContinue={() => {
          const g = loadGame()
          if (g) {
            prevPhase.current = g.phase
            setState(g)
          }
        }}
        hasSave={hasSave()}
      />
    )
  }

  const runningState = state
  const openPlayer = (idOrPlayer: string | Player, team?: string) => {
    if (typeof idOrPlayer === 'string') {
      const found = findPlayer(runningState, idOrPlayer)
      if (found) setViewPlayer({ player: found.player, team: found.team })
    } else {
      setViewPlayer({ player: idOrPlayer, team })
    }
  }

  const team = state.teams[state.userTeam]
  const userRow = getStandings(state).league.find((r) => r.team === state.userTeam)

  const pendingCount = state.pendingOffers.length
  const tabs: TabDef[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'roster', label: 'Roster' },
    { key: 'standings', label: 'Standings' },
    { key: 'leaders', label: 'Leaders' },
    { key: 'trades', label: 'Trades', badge: pendingCount > 0 ? String(pendingCount) : undefined },
  ]
  if (state.phase === 'playoffs' || (state.playoffs && state.playoffs.length > 0)) {
    tabs.push({ key: 'playoffs', label: 'Playoffs', badge: state.phase === 'playoffs' ? '●' : undefined })
  }
  if (state.phase === 'offseason') {
    tabs.push({ key: 'offseason', label: 'Offseason', badge: '●' })
  }
  tabs.push({ key: 'history', label: 'History' })

  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'dashboard'

  const rootStyle = {
    ['--team']: team.color || '#2a6cff',
    ['--team2']: team.colorSecondary || '#ffffff',
  } as React.CSSProperties

  return (
    <UIContext.Provider value={{ pushToast, openTeam, startTrade, openPlayer, whatWouldItTake }}>
      <div className="app" style={rootStyle}>
        <Header s={state} userRow={userRow} />
        <TabNav tabs={tabs} active={activeTab} onChange={setTab} />
        <main className="app-main">
          {activeTab === 'dashboard' && <Dashboard s={state} apply={apply} onNavigate={setTab} busy={false} />}
          {activeTab === 'roster' && <Roster s={state} apply={apply} />}
          {activeTab === 'standings' && <Standings s={state} />}
          {activeTab === 'leaders' && <Leaders s={state} />}
          {activeTab === 'trades' && (
            <Trades s={state} apply={apply} intent={tradeIntent} onConsumeIntent={() => setTradeIntent(null)} />
          )}
          {activeTab === 'playoffs' && <Playoffs s={state} apply={apply} busy={false} />}
          {activeTab === 'offseason' && (
            <OffseasonHub s={state} apply={apply} devSnap={devSnap} onSnapshot={setDevSnap} />
          )}
          {activeTab === 'history' && <History s={state} />}

          <div style={{ marginTop: 40, textAlign: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={abandon} title="Delete save and return to team select">
              Abandon dynasty
            </button>
          </div>
        </main>
      </div>

      {viewTeam && state.teams[viewTeam] && (
        <TeamViewer s={state} abbrev={viewTeam} onClose={() => setViewTeam(null)} />
      )}
      {viewPlayer && (
        <PlayerModal
          s={state}
          player={viewPlayer.player}
          team={viewPlayer.team}
          onClose={() => setViewPlayer(null)}
        />
      )}
      {wwit && (
        <WhatWouldItTakeModal
          s={state}
          partner={wwit.partner}
          playerId={wwit.playerId}
          onClose={() => setWwit(null)}
          onLoad={(offer) => startTrade(offer.to, offer)}
        />
      )}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </UIContext.Provider>
  )
}

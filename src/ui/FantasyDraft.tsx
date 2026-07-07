import { useMemo, useState } from 'react'
import type { GameState, Player } from '../types'
import { fantasyPick, autoFantasyPick, autoCompleteFantasyDraft, getFantasyBoard, getCapUsage } from '../engine'
import { Card, OvrBadge, PosTag, TeamLogo, CapBar, Modal, PlayerLink, Flag } from './components'
import { fmtM, ordinal } from './format'
import { rosterCounts, buildPlayerIndex } from './util'
import { PosFilter, matchesPos, SearchInput } from './filters'
import { useUI } from './uiContext'

/** Roster construction targets for the fantasy dynasty draft. */
const TARGET = { f: 13, d: 7, g: 2 }

interface TickerPick {
  pick: number
  team: string
  playerName: string
}

/**
 * Fantasy dynasty draft room. Renders while phase === 'fantasyDraft'. Clock,
 * round and on-the-clock team are derived from the types-guaranteed
 * `s.fantasyDraft` snake state; the pick ticker comes from getFantasyBoard.
 * Making the final pick flips the phase to 'regular' (engine), and the app
 * routes to the dashboard automatically.
 */
export function FantasyDraft({ s, apply }: { s: GameState; apply: (n: GameState) => void }) {
  const { pushToast } = useUI()
  const fd = s.fantasyDraft
  const [posF, setPosF] = useState<'ALL' | 'F' | 'D' | 'G'>('ALL')
  const [query, setQuery] = useState('')
  const [confirmAuto, setConfirmAuto] = useState(false)

  const idx = useMemo(() => buildPlayerIndex(s), [s])
  const byName = useMemo(() => {
    const m = new Map<string, Player>()
    for (const ref of idx.values()) if (!m.has(ref.player.name)) m.set(ref.player.name, ref.player)
    return m
  }, [idx])

  if (!fd) {
    return (
      <Card title="Fantasy Draft">
        <div className="news-empty">The fantasy draft has concluded.</div>
      </Card>
    )
  }

  const numTeams = fd.order.length
  const totalPicks = numTeams * fd.rounds
  const overall = fd.pickIndex // 0-based
  const round0 = Math.floor(overall / numTeams)
  const posInRound = overall % numTeams
  const onClock = round0 % 2 === 0 ? fd.order[posInRound] : fd.order[numTeams - 1 - posInRound]
  const complete = overall >= totalPicks
  const onUserClock = !complete && onClock === s.userTeam

  // Pick history for the ticker (engine-provided; `recent` is newest last).
  const board = getFantasyBoard(s)
  const ticker: TickerPick[] = board.recent ?? []

  const team = s.teams[s.userTeam]
  const counts = rosterCounts(team.roster)
  const cap = getCapUsage(s, s.userTeam)

  const pool = [...fd.pool]
    .filter((p) => matchesPos(p, posF) && p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.overall - a.overall || b.potential - a.potential)

  function draft(p: Player) {
    apply(fantasyPick(s, p.id))
    pushToast('success', `Drafted ${p.name}.`)
  }
  function autoPick() {
    apply(autoFantasyPick(s))
  }
  function autoComplete() {
    apply(autoCompleteFantasyDraft(s))
    setConfirmAuto(false)
    pushToast('success', 'Draft auto-completed — dropping the puck on the season.')
  }

  return (
    <div className="stack">
      <div className={`banner ${onUserClock ? 'playoffs' : ''}`}>
        <div className="banner-body">
          <h4>
            {complete
              ? 'Fantasy Draft Complete'
              : onUserClock
                ? `You are on the clock — Round ${round0 + 1}, ${ordinal(overall + 1)} overall`
                : `Round ${round0 + 1}, ${ordinal(overall + 1)} overall — ${s.teams[onClock]?.name ?? onClock} selecting`}
          </h4>
          <p>
            {complete
              ? 'Every NHL player has been drafted. Starting the regular season…'
              : 'Every NHL player enters one big draft. Build your whole roster, one pick at a time.'}
          </p>
        </div>
        {!complete && (
          <div className="row" style={{ gap: 8 }}>
            {onUserClock && (
              <button className="btn btn-primary" onClick={autoPick}>
                Auto Pick
              </button>
            )}
            <button className="btn" onClick={() => setConfirmAuto(true)}>
              Auto-complete Draft
            </button>
          </div>
        )}
      </div>

      {confirmAuto && (
        <Modal onClose={() => setConfirmAuto(false)}>
          <div className="modal-head">
            <div className="modal-title">
              <h3>Auto-complete the draft?</h3>
              <div className="meta">The front office finishes every remaining pick, including yours.</div>
            </div>
            <button className="modal-close" onClick={() => setConfirmAuto(false)} aria-label="Close">×</button>
          </div>
          <div className="modal-body">
            <div className="stack">
              <div className="hint">This drafts the rest of the league automatically and starts the season. You can review your roster afterward.</div>
              <div className="row">
                <button className="btn btn-primary btn-lg" onClick={autoComplete}>Confirm — auto-complete</button>
                <button className="btn btn-ghost" onClick={() => setConfirmAuto(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      <div className="draft-ticker-strip">
        {ticker.length === 0 ? (
          <span className="hint">Picks will scroll here as they come in.</span>
        ) : (
          [...ticker]
            .slice(-24)
            .reverse()
            .map((r) => (
              <span key={r.pick} className={`ticker-pick ${r.team === s.userTeam ? 'me' : ''}`}>
                <span className="tp-num">{r.pick}</span>
                <TeamLogo team={s.teams[r.team]} size={16} />
                <span className="tp-name">{r.playerName}</span>
              </span>
            ))
        )}
      </div>

      <div className="grid dash-grid">
        <Card
          title={`Best Available · ${fd.pool.length}`}
          right={
            <div className="row" style={{ gap: 8 }}>
              <PosFilter value={posF} onChange={setPosF} />
              <SearchInput value={query} onChange={setQuery} placeholder="Search players" />
            </div>
          }
        >
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Pos</th>
                  <th className="num m-hide">Age</th>
                  <th className="num">OVR</th>
                  <th className="num m-hide">POT</th>
                  <th className="num m-hide">Cap</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pool.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 20 }}>
                      No players match those filters.
                    </td>
                  </tr>
                )}
                {pool.slice(0, 150).map((p) => (
                  <tr key={p.id}>
                    <td className="name-cell">
                      <PlayerLink id={p.id} player={p}>{p.name}</PlayerLink> <Flag nat={p.nationality} />
                    </td>
                    <td><PosTag pos={p.pos} /></td>
                    <td className="num m-hide">{p.age}</td>
                    <td className="num"><OvrBadge overall={p.overall} /></td>
                    <td className="num m-hide">{p.potential}</td>
                    <td className="num m-hide">{p.contract ? fmtM(p.contract.capHit) : '—'}</td>
                    <td>
                      {onUserClock && (
                        <button className="btn btn-sm btn-primary" onClick={() => draft(p)}>
                          Draft
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={`Your Roster · ${team.roster.length}`}>
          <div className="card-pad stack" style={{ gap: 12 }}>
            <div className="tiles" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <RosterTarget k="Forwards" have={counts.f} target={TARGET.f} />
              <RosterTarget k="Defense" have={counts.d} target={TARGET.d} />
              <RosterTarget k="Goalies" have={counts.g} target={TARGET.g} />
            </div>
            <CapBar used={cap.used} cap={cap.cap} capYear={cap.capYear} />
            <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Pos</th>
                    <th className="num">OVR</th>
                    <th className="num m-hide">Cap</th>
                  </tr>
                </thead>
                <tbody>
                  {team.roster.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                        No picks yet — your drafted players appear here.
                      </td>
                    </tr>
                  )}
                  {[...team.roster]
                    .sort((a, b) => b.overall - a.overall)
                    .map((p) => (
                      <tr key={p.id} className="clickable">
                        <td className="name-cell">
                          <PlayerLink id={p.id} player={p} team={s.userTeam}>{p.name}</PlayerLink>
                        </td>
                        <td><PosTag pos={p.pos} /></td>
                        <td className="num"><OvrBadge overall={p.overall} /></td>
                        <td className="num m-hide">{p.contract ? fmtM(p.contract.capHit) : '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function RosterTarget({ k, have, target }: { k: string; have: number; target: number }) {
  const ok = have >= target
  return (
    <div className="tile">
      <div className="k">{k}</div>
      <div className="v">
        {have}
        <small> / {target}</small> {ok ? <span style={{ color: 'var(--good)' }}>✓</span> : null}
      </div>
    </div>
  )
}

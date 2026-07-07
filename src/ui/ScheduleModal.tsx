import { useState } from 'react'
import type { GameState, Game } from '../types'
import { Modal, TeamLogo, TeamLink } from './components'
import { BoxScoreModal } from './BoxScore'
import { dayLabel } from './util'

type FormResult = 'W' | 'L' | 'OTL'

function resultFor(g: Game, team: string): FormResult {
  const forGoals = g.home === team ? g.homeGoals ?? 0 : g.awayGoals ?? 0
  const oppGoals = g.home === team ? g.awayGoals ?? 0 : g.homeGoals ?? 0
  if (forGoals > oppGoals) return 'W'
  if (g.endType === 'OT' || g.endType === 'SO') return 'OTL'
  return 'L'
}

/** Full-season schedule for the user team: played games (clickable box scores)
 *  and upcoming opponents, in calendar order. */
export function ScheduleModal({ s, onClose }: { s: GameState; onClose: () => void }) {
  const [boxGame, setBoxGame] = useState<Game | null>(null)
  const games = s.schedule
    .filter((g) => g.home === s.userTeam || g.away === s.userTeam)
    .sort((a, b) => a.day - b.day)

  let record = { w: 0, l: 0, otl: 0 }
  for (const g of games) {
    if (!g.played) continue
    const r = resultFor(g, s.userTeam)
    if (r === 'W') record.w++
    else if (r === 'L') record.l++
    else record.otl++
  }

  return (
    <Modal onClose={onClose} wide>
      <div className="modal-head">
        <div className="modal-title">
          <h3>Full Schedule</h3>
          <div className="meta">
            {s.teams[s.userTeam]?.city} {s.teams[s.userTeam]?.name} · {record.w}-{record.l}-{record.otl}
          </div>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="modal-body">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th></th>
                <th>Opponent</th>
                <th className="num">Result</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => {
                const home = g.home === s.userTeam
                const oppAbbrev = home ? g.away : g.home
                const opp = s.teams[oppAbbrev]
                if (!g.played) {
                  return (
                    <tr key={g.id}>
                      <td className="log-date">{dayLabel(g.day)}</td>
                      <td className="ha">{home ? 'vs' : '@'}</td>
                      <td>
                        <TeamLink abbrev={oppAbbrev} className="game-opp-link">
                          <TeamLogo team={opp} size={18} />
                          <span>{opp?.name ?? oppAbbrev}</span>
                        </TeamLink>
                      </td>
                      <td className="num muted">—</td>
                    </tr>
                  )
                }
                const r = resultFor(g, s.userTeam)
                const forGoals = home ? g.homeGoals ?? 0 : g.awayGoals ?? 0
                const oppGoals = home ? g.awayGoals ?? 0 : g.homeGoals ?? 0
                return (
                  <tr key={g.id} className="clickable" title="View box score" onClick={() => setBoxGame(g)}>
                    <td className="log-date">{dayLabel(g.day)}</td>
                    <td className="ha">{home ? 'vs' : '@'}</td>
                    <td>
                      <TeamLink abbrev={oppAbbrev} className="game-opp-link">
                        <TeamLogo team={opp} size={18} />
                        <span>{opp?.name ?? oppAbbrev}</span>
                      </TeamLink>
                    </td>
                    <td className="num">
                      <span className={`result-pill ${r.toLowerCase()}`}>{r}</span>{' '}
                      {forGoals}-{oppGoals}
                      {g.endType && g.endType !== 'REG' ? ` ${g.endType}` : ''}
                    </td>
                  </tr>
                )
              })}
              {games.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 20 }}>
                    No games scheduled.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {boxGame && <BoxScoreModal s={s} game={boxGame} onClose={() => setBoxGame(null)} />}
    </Modal>
  )
}

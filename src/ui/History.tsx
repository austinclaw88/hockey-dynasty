import { useState } from 'react'
import type { GameState, SeasonSummary } from '../types'
import { Card, Crest } from './components'
import { seasonLabel, fmtRecord } from './format'

export function History({ s }: { s: GameState }) {
  const history = s.history
  const [selYear, setSelYear] = useState<number | null>(history.length ? history[history.length - 1].year : null)

  if (history.length === 0) {
    return (
      <Card title="History">
        <div className="news-empty">No seasons in the books yet. Come back after your first year.</div>
      </Card>
    )
  }

  const cupsByUser = history.filter((h) => h.cupWinner === s.userTeam).length
  const selected = history.find((h) => h.year === selYear) ?? history[history.length - 1]

  return (
    <div className="stack">
      {s.phase === 'over' && (
        <div className="banner over">
          <div className="banner-body">
            <h4>Dynasty complete — {s.teams[s.userTeam].city} {s.teams[s.userTeam].name}</h4>
            <p>
              {history.length} seasons managed · {cupsByUser} Stanley Cup{cupsByUser === 1 ? '' : 's'} won.
            </p>
          </div>
        </div>
      )}

      <Card title="Season by Season">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Season</th>
                <th>Your Finish</th>
                <th>Your Record</th>
                <th>Cup Winner</th>
                <th>Runner-Up</th>
                <th>President&apos;s</th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((h) => (
                <tr key={h.year} className={`clickable ${h.year === selYear ? 'me' : ''}`} onClick={() => setSelYear(h.year)}>
                  <td className="name-cell">{seasonLabel(h.year)}</td>
                  <td>{h.userFinish}</td>
                  <td className="num">
                    {fmtRecord(h.userRecord.w, h.userRecord.l, h.userRecord.otl)} · {h.userRecord.pts}p
                  </td>
                  <td>
                    <TeamCell s={s} abbrev={h.cupWinner} />
                  </td>
                  <td>
                    <TeamCell s={s} abbrev={h.cupRunnerUp} />
                  </td>
                  <td>
                    <TeamCell s={s} abbrev={h.presidentsTrophy} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title={`Awards · ${seasonLabel(selected.year)}`}>
          {selected.awards.length === 0 ? (
            <div className="news-empty">No awards recorded.</div>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Award</th>
                    <th>Winner</th>
                    <th>Team</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.awards.map((a, i) => (
                    <tr key={i} className={a.team === s.userTeam ? 'me' : ''}>
                      <td className="name-cell">{a.name}</td>
                      <td>{a.playerName}</td>
                      <td>{a.team}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <FranchiseLeaders s={s} />
      </div>

      <Card title={`Top Scorers · ${seasonLabel(selected.year)}`}>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="num" style={{ width: 28 }}>#</th>
                <th>Player</th>
                <th>Team</th>
                <th className="num">G</th>
                <th className="num">PTS</th>
              </tr>
            </thead>
            <tbody>
              {selected.topScorers.map((t, i) => (
                <tr key={i} className={t.team === s.userTeam ? 'me' : ''}>
                  <td className="num muted">{i + 1}</td>
                  <td className="name-cell">{t.playerName}</td>
                  <td>{t.team}</td>
                  <td className="num">{t.goals}</td>
                  <td className="num" style={{ fontWeight: 800 }}>{t.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function TeamCell({ s, abbrev }: { s: GameState; abbrev: string }) {
  const t = s.teams[abbrev]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Crest team={t} size="mini" />
      {t ? t.name : abbrev}
    </span>
  )
}

/**
 * Franchise career-points leaderboard. GameState has no career-stat store,
 * so this aggregates the per-season top-scorer snapshots for the user team.
 * It is an approximation (only players who cracked a season's top-10 count).
 */
function FranchiseLeaders({ s }: { s: GameState }) {
  const agg = new Map<string, { points: number; goals: number; seasons: number }>()
  for (const h of s.history) {
    for (const t of h.topScorers) {
      if (t.team !== s.userTeam) continue
      const e = agg.get(t.playerName) ?? { points: 0, goals: 0, seasons: 0 }
      e.points += t.points
      e.goals += t.goals
      e.seasons += 1
      agg.set(t.playerName, e)
    }
  }
  const rows = [...agg.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.points - a.points).slice(0, 15)
  return (
    <Card title="Franchise Scoring">
      {rows.length === 0 ? (
        <div className="news-empty">Star players will appear here as your dynasty grows.</div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Seasons</th>
                <th className="num">G</th>
                <th className="num">PTS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="name-cell">{r.name}</td>
                  <td className="num">{r.seasons}</td>
                  <td className="num">{r.goals}</td>
                  <td className="num" style={{ fontWeight: 800 }}>{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

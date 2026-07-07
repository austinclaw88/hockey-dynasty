import { useMemo, useState } from 'react'
import type { GameState } from '../types'
import { Card, Crest, PlayerLink } from './components'
import { seasonLabel, fmtRecord } from './format'
import { buildPlayerIndex } from './util'

export function History({ s }: { s: GameState }) {
  const history = s.history
  const [selYear, setSelYear] = useState<number | null>(history.length ? history[history.length - 1].year : null)

  if (history.length === 0) {
    return (
      <div className="stack">
        <Card title="History">
          <div className="news-empty">No seasons in the books yet — but your all-time franchise records already include the real 2021+ history.</div>
        </Card>
        <FranchiseRecords s={s} />
      </div>
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

      <FranchiseRecords s={s} />

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

interface CareerAgg {
  id: string
  name: string
  gp: number
  goals: number
  assists: number
  points: number
  seasons: number
}
interface SeasonBest {
  id: string
  name: string
  year: number
  value: number
}

/**
 * All-time franchise records computed from s.careers, restricted to seasons the
 * player spent on the user's team. Career leaders (points/goals/assists/games,
 * top 10) plus single-season bests. Covers the bundled real history (2021+) and
 * every completed simmed season.
 */
function FranchiseRecords({ s }: { s: GameState }) {
  const { career, bestPoints, bestGoals, bestAssists } = useMemo(() => {
    const idx = buildPlayerIndex(s)
    const nameFor = (id: string, fallback: string) => idx.get(id)?.player.name ?? fallback
    const agg = new Map<string, CareerAgg>()
    let bPts: SeasonBest | null = null
    let bG: SeasonBest | null = null
    let bA: SeasonBest | null = null

    for (const id of Object.keys(s.careers)) {
      for (const cs of s.careers[id]) {
        if (cs.team !== s.userTeam) continue
        const name = nameFor(id, `#${id.slice(0, 6)}`)
        const e = agg.get(id) ?? { id, name, gp: 0, goals: 0, assists: 0, points: 0, seasons: 0 }
        e.gp += cs.gp
        e.goals += cs.goals
        e.assists += cs.assists
        e.points += cs.points
        e.seasons += 1
        agg.set(id, e)
        if (!bPts || cs.points > bPts.value) bPts = { id, name, year: cs.year, value: cs.points }
        if (!bG || cs.goals > bG.value) bG = { id, name, year: cs.year, value: cs.goals }
        if (!bA || cs.assists > bA.value) bA = { id, name, year: cs.year, value: cs.assists }
      }
    }
    return { career: [...agg.values()], bestPoints: bPts, bestGoals: bG, bestAssists: bA }
  }, [s])

  if (career.length === 0) {
    return (
      <Card title="Franchise Records">
        <div className="news-empty">
          All-time leaders appear here once a season is in the books. Covers bundled real history (2021+) plus simmed seasons.
        </div>
      </Card>
    )
  }

  const top = (key: 'points' | 'goals' | 'assists' | 'gp') =>
    [...career].sort((a, b) => b[key] - a[key]).slice(0, 10)

  return (
    <Card title="Franchise Records">
      <div className="card-pad hint" style={{ paddingBottom: 0 }}>
        All-time leaders for the {s.teams[s.userTeam]?.name}. Covers the bundled real history (2021+) plus your simmed seasons.
      </div>

      {(bestPoints || bestGoals || bestAssists) && (
        <div className="card-pad">
          <div className="mini-title">Single-Season Bests</div>
          <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <BestTile label="Points" best={bestPoints} s={s} />
            <BestTile label="Goals" best={bestGoals} s={s} />
            <BestTile label="Assists" best={bestAssists} s={s} />
          </div>
        </div>
      )}

      <div className="grid grid-2" style={{ padding: 16, paddingTop: 0 }}>
        <LeaderTable title="Career Points" rows={top('points')} statKey="points" s={s} />
        <LeaderTable title="Career Goals" rows={top('goals')} statKey="goals" s={s} />
        <LeaderTable title="Career Assists" rows={top('assists')} statKey="assists" s={s} />
        <LeaderTable title="Games Played" rows={top('gp')} statKey="gp" s={s} />
      </div>
    </Card>
  )
}

function BestTile({ label, best, s }: { label: string; best: SeasonBest | null; s: GameState }) {
  if (!best) return null
  return (
    <div className="tile">
      <div className="k">{label} · Season</div>
      <div className="v">{best.value}</div>
      <div className="hint" style={{ marginTop: 2 }}>
        <PlayerLink id={best.id} team={s.userTeam}>{best.name}</PlayerLink> · {seasonLabel(best.year)}
      </div>
    </div>
  )
}

function LeaderTable({
  title,
  rows,
  statKey,
  s,
}: {
  title: string
  rows: CareerAgg[]
  statKey: 'points' | 'goals' | 'assists' | 'gp'
  s: GameState
}) {
  return (
    <div>
      <div className="mini-title">{title}</div>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="num" style={{ width: 24 }}>#</th>
              <th>Player</th>
              <th className="num m-hide">Sea</th>
              <th className="num">{statKey === 'gp' ? 'GP' : statKey === 'points' ? 'PTS' : statKey === 'goals' ? 'G' : 'A'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="num muted">{i + 1}</td>
                <td className="name-cell">
                  <PlayerLink id={r.id} team={s.userTeam}>{r.name}</PlayerLink>
                </td>
                <td className="num m-hide">{r.seasons}</td>
                <td className="num" style={{ fontWeight: 800 }}>{r[statKey]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

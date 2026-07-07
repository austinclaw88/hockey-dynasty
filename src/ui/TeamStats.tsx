import { useEffect, useMemo, useState } from 'react'
import type { GameState, Player, SeasonStatLine } from '../types'
import { Card, OvrBadge, PosTag, TeamLogo, PlayerLink } from './components'
import { PosFilter, matchesPos } from './filters'
import type { PosFilterValue } from './filters'
import { fmtSigned, fmtGaa, fmtSvPct, posGroup } from './format'

type SkaterSort = 'name' | 'pos' | 'gp' | 'goals' | 'assists' | 'points' | 'plusMinus' | 'pim'
type Source = 'season' | 'playoffs'

const EMPTY: SeasonStatLine = { playerId: '', gp: 0, goals: 0, assists: 0, points: 0, plusMinus: 0, pim: 0 }

/**
 * Standalone Team Stats page: pick any club and read how its players are
 * producing this season (or in the playoffs). Skaters up top, goalies beneath.
 */
export function TeamStats({ s, initialTeam, intent }: { s: GameState; initialTeam?: string; intent?: number }) {
  const [team, setTeam] = useState<string>(initialTeam ?? s.userTeam)
  const [posF, setPosF] = useState<PosFilterValue>('ALL')
  const [source, setSource] = useState<Source>('season')
  const [sort, setSort] = useState<{ key: SkaterSort; dir: 1 | -1 }>({ key: 'points', dir: -1 })

  // Re-select when navigated here with a specific team (e.g. from a team viewer).
  useEffect(() => {
    if (intent && intent > 0 && initialTeam) setTeam(initialTeam)
  }, [intent, initialTeam])

  const hasPlayoffs = Object.keys(s.playoffStats ?? {}).length > 0
  const effSource: Source = source === 'playoffs' && hasPlayoffs ? 'playoffs' : 'season'
  const stats = effSource === 'playoffs' ? s.playoffStats ?? {} : s.stats

  const t = s.teams[team]
  const teamOptions = useMemo(
    () => Object.keys(s.teams).sort((a, b) => `${s.teams[a].city}`.localeCompare(s.teams[b].city)),
    [s.teams],
  )

  const roster = t?.roster ?? []
  const skaters = useMemo(() => {
    const list = roster.filter((p) => p.pos !== 'G' && matchesPos(p, posF === 'G' ? 'ALL' : posF))
    return list.sort((a, b) => skCmp(a, b, sort.key, stats) * sort.dir)
  }, [roster, posF, sort, stats])
  const goalies = useMemo(() => roster.filter((p) => p.pos === 'G').sort((a, b) => (stats[b.id]?.gp ?? 0) - (stats[a.id]?.gp ?? 0)), [roster, stats])

  function th(key: SkaterSort, label: string, cls = '') {
    const active = sort.key === key
    return (
      <th
        className={`sortable num ${cls}`}
        onClick={() => setSort((p) => ({ key, dir: p.key === key && p.dir === -1 ? 1 : -1 }))}
      >
        {label}
        {active ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
      </th>
    )
  }

  const sourceLabel = effSource === 'playoffs' ? 'Playoffs' : 'Season'

  return (
    <div className="stack">
      <Card title="Team Stats">
        <div className="card-pad team-stats-controls">
          <div className="team-stats-picker">
            <TeamLogo team={t} size={26} />
            <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Select team">
              {teamOptions.map((a) => (
                <option key={a} value={a}>
                  {s.teams[a].city} {s.teams[a].name}
                  {a === s.userTeam ? ' ★' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <PosFilter value={posF} onChange={setPosF} />
            {hasPlayoffs && (
              <div className="chip-row" role="tablist" aria-label="Stat source">
                {(['season', 'playoffs'] as const).map((src) => (
                  <button
                    key={src}
                    type="button"
                    className={`chip ${source === src ? 'active' : ''}`}
                    aria-pressed={source === src}
                    onClick={() => setSource(src)}
                  >
                    {src === 'season' ? 'Season' : 'Playoffs'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      {posF !== 'G' && (
        <Card title={`Skaters · ${sourceLabel}`}>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th
                    className="sortable"
                    onClick={() => setSort((p) => ({ key: 'name', dir: p.key === 'name' && p.dir === -1 ? 1 : -1 }))}
                  >
                    Player{sort.key === 'name' ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
                  </th>
                  <th>Pos</th>
                  {th('gp', 'GP')}
                  {th('goals', 'G')}
                  {th('assists', 'A')}
                  {th('points', 'P')}
                  {th('plusMinus', '+/-', 'm-hide')}
                  {th('pim', 'PIM', 'm-hide')}
                </tr>
              </thead>
              <tbody>
                {skaters.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 18 }}>
                      No skaters match those filters.
                    </td>
                  </tr>
                )}
                {skaters.map((p) => {
                  const line = stats[p.id] ?? EMPTY
                  return (
                    <tr key={p.id} className={team === s.userTeam ? 'me' : ''}>
                      <td className="name-cell">
                        <PlayerLink id={p.id} player={p} team={team}>
                          {p.name}
                        </PlayerLink>{' '}
                        <OvrBadge overall={p.overall} />
                      </td>
                      <td>
                        <PosTag pos={p.pos} />
                      </td>
                      <td className="num">{line.gp}</td>
                      <td className="num">{line.goals}</td>
                      <td className="num">{line.assists}</td>
                      <td className="num" style={{ fontWeight: 800 }}>{line.points}</td>
                      <td className="num m-hide">{fmtSigned(line.plusMinus)}</td>
                      <td className="num m-hide">{line.pim}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title={`Goaltending · ${sourceLabel}`}>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">GP</th>
                <th className="num">W</th>
                <th className="num m-hide">L</th>
                <th className="num m-hide">OTL</th>
                <th className="num m-hide">SO</th>
                <th className="num">GAA</th>
                <th className="num">SV%</th>
              </tr>
            </thead>
            <tbody>
              {goalies.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 18 }}>
                    No goaltenders on this roster.
                  </td>
                </tr>
              )}
              {goalies.map((p) => {
                const line = stats[p.id] ?? EMPTY
                return (
                  <tr key={p.id} className={team === s.userTeam ? 'me' : ''}>
                    <td className="name-cell">
                      <PlayerLink id={p.id} player={p} team={team}>
                        {p.name}
                      </PlayerLink>{' '}
                      <OvrBadge overall={p.overall} />
                    </td>
                    <td className="num">{line.gp}</td>
                    <td className="num">{line.wins ?? 0}</td>
                    <td className="num m-hide">{line.losses ?? 0}</td>
                    <td className="num m-hide">{line.otl ?? 0}</td>
                    <td className="num m-hide">{line.shutouts ?? 0}</td>
                    <td className="num">{fmtGaa(line.gaa)}</td>
                    <td className="num">{fmtSvPct(line.svPct)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function skCmp(a: Player, b: Player, key: SkaterSort, stats: Record<string, SeasonStatLine>): number {
  const la = stats[a.id] ?? EMPTY
  const lb = stats[b.id] ?? EMPTY
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'pos':
      return posGroup(a.pos) - posGroup(b.pos) || a.pos.localeCompare(b.pos)
    case 'gp':
      return la.gp - lb.gp
    case 'goals':
      return la.goals - lb.goals
    case 'assists':
      return la.assists - lb.assists
    case 'points':
      return la.points - lb.points || la.goals - lb.goals
    case 'plusMinus':
      return la.plusMinus - lb.plusMinus
    case 'pim':
      return la.pim - lb.pim
    default:
      return 0
  }
}

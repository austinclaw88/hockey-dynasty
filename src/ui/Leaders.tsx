import { useState } from 'react'
import type { GameState, SeasonStatLine } from '../types'
import { getLeaders } from '../engine'
import { Card, Crest, TeamLink, PlayerLink } from './components'
import { buildPlayerIndex } from './util'
import { fmtSigned, fmtGaa, fmtSvPct } from './format'

type Tab = 'points' | 'goals' | 'assists' | 'goalies'

const TAB_TITLE: Record<Tab, string> = {
  points: 'Points',
  goals: 'Goals',
  assists: 'Assists',
  goalies: 'Goaltending',
}

export function Leaders({ s }: { s: GameState }) {
  const [tab, setTab] = useState<Tab>('points')
  const leaders = getLeaders(s)
  const idx = buildPlayerIndex(s)

  // `assists` is provided by the engine alongside points/goals; read defensively.
  const assists = (leaders as { assists?: SeasonStatLine[] }).assists ?? []
  const rows: SeasonStatLine[] =
    tab === 'assists' ? assists : tab === 'goalies' ? leaders.goalies : tab === 'goals' ? leaders.goals : leaders.points

  return (
    <div className="stack">
      <div className="subtabs">
        <button className={`subtab ${tab === 'points' ? 'active' : ''}`} onClick={() => setTab('points')}>
          Points
        </button>
        <button className={`subtab ${tab === 'goals' ? 'active' : ''}`} onClick={() => setTab('goals')}>
          Goals
        </button>
        <button className={`subtab ${tab === 'assists' ? 'active' : ''}`} onClick={() => setTab('assists')}>
          Assists
        </button>
        <button className={`subtab ${tab === 'goalies' ? 'active' : ''}`} onClick={() => setTab('goalies')}>
          Goalies
        </button>
      </div>

      <Card title={`League Leaders · ${TAB_TITLE[tab]}`}>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              {tab === 'goalies' ? (
                <tr>
                  <th className="num" style={{ width: 28 }}>
                    #
                  </th>
                  <th>Player</th>
                  <th>Team</th>
                  <th className="num">GP</th>
                  <th className="num">W</th>
                  <th className="num">L</th>
                  <th className="num">OTL</th>
                  <th className="num">SO</th>
                  <th className="num">GAA</th>
                  <th className="num">SV%</th>
                </tr>
              ) : (
                <tr>
                  <th className="num" style={{ width: 28 }}>
                    #
                  </th>
                  <th>Player</th>
                  <th>Team</th>
                  <th className="num">GP</th>
                  <th className="num">G</th>
                  <th className="num">A</th>
                  <th className="num">PTS</th>
                  <th className="num">+/-</th>
                  <th className="num">PIM</th>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((line, i) => (
                <LeaderRow key={line.playerId} line={line} rank={i + 1} tab={tab} s={s} idx={idx} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function LeaderRow({
  line,
  rank,
  tab,
  s,
  idx,
}: {
  line: SeasonStatLine
  rank: number
  tab: Tab
  s: GameState
  idx: ReturnType<typeof buildPlayerIndex>
}) {
  const ref = idx.get(line.playerId)
  const name = ref?.player.name ?? line.playerId
  const team = ref?.team
  const t = team ? s.teams[team] : undefined
  const isMe = team === s.userTeam
  return (
    <tr className={isMe ? 'me' : ''}>
      <td className="num muted">{rank}</td>
      <td className="name-cell">
        <PlayerLink id={line.playerId} player={ref?.player}>
          {name}
        </PlayerLink>
      </td>
      <td>
        {team ? (
          <TeamLink abbrev={team} className="team-link-inline">
            <Crest team={t} size="mini" />
            {team}
          </TeamLink>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Crest team={t} size="mini" />—
          </span>
        )}
      </td>
      {tab === 'goalies' ? (
        <>
          <td className="num">{line.gp}</td>
          <td className="num">{line.wins ?? 0}</td>
          <td className="num">{line.losses ?? 0}</td>
          <td className="num">{line.otl ?? 0}</td>
          <td className="num">{line.shutouts ?? 0}</td>
          <td className="num">{fmtGaa(line.gaa)}</td>
          <td className="num">{fmtSvPct(line.svPct)}</td>
        </>
      ) : (
        <>
          <td className="num">{line.gp}</td>
          <td className="num">{line.goals}</td>
          <td className="num" style={tab === 'assists' ? { fontWeight: 800 } : undefined}>
            {line.assists}
          </td>
          <td className="num" style={{ fontWeight: tab === 'assists' ? 500 : 800 }}>
            {line.points}
          </td>
          <td className="num">{fmtSigned(line.plusMinus)}</td>
          <td className="num">{line.pim}</td>
        </>
      )}
    </tr>
  )
}

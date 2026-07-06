import { useState } from 'react'
import type { GameState, StandingsRow, Division } from '../types'
import { getStandings } from '../engine'
import { Card, Crest } from './components'
import { divisionsByConference } from './util'
import { fmtSigned } from './format'

type SortKey = 'pts' | 'gp' | 'w' | 'l' | 'otl' | 'gf' | 'ga' | 'diff'

export function Standings({ s }: { s: GameState }) {
  const standings = getStandings(s)
  const conf = divisionsByConference()

  return (
    <div className="stack">
      <p className="section-sub" style={{ marginBottom: 0 }}>
        Top 3 in each division plus 2 wildcards per conference make the playoffs. The line under a table marks
        the cutline.
      </p>
      {(['East', 'West'] as const).map((c) => (
        <div key={c} className="stack">
          <h2 className="section-title">{c}ern Conference</h2>
          <div className="grid grid-2">
            {conf[c].map((div) => (
              <DivisionTable
                key={div}
                title={div}
                rows={standings.byDivision[div] ?? []}
                userTeam={s.userTeam}
                s={s}
                cutAfter={3}
              />
            ))}
          </div>
          <WildcardTable conf={c} divs={conf[c]} standings={standings} userTeam={s.userTeam} s={s} />
        </div>
      ))}
    </div>
  )
}

function DivisionTable({
  title,
  rows,
  userTeam,
  s,
  cutAfter,
}: {
  title: string
  rows: StandingsRow[]
  userTeam: string
  s: GameState
  cutAfter: number
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'pts', dir: -1 })
  const sorted = sortRows(rows, sort)
  const showCut = sort.key === 'pts' && sort.dir === -1
  return (
    <Card title={title}>
      <StandingsTableBody rows={sorted} userTeam={userTeam} s={s} sort={sort} setSort={setSort} cutAfter={showCut ? cutAfter : -1} rank />
    </Card>
  )
}

function WildcardTable({
  conf,
  divs,
  standings,
  userTeam,
  s,
}: {
  conf: string
  divs: Division[]
  standings: ReturnType<typeof getStandings>
  userTeam: string
  s: GameState
}) {
  // teams outside the top-3 of each division, ranked by points => WC race
  const pool: StandingsRow[] = []
  for (const div of divs) {
    const rows = sortRows(standings.byDivision[div] ?? [], { key: 'pts', dir: -1 })
    pool.push(...rows.slice(3))
  }
  const sorted = sortRows(pool, { key: 'pts', dir: -1 })
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'pts', dir: -1 })
  const finalRows = sortRows(pool, sort)
  const showCut = sort.key === 'pts' && sort.dir === -1
  void sorted
  return (
    <Card title={`${conf} Wildcard Race`}>
      <StandingsTableBody rows={finalRows} userTeam={userTeam} s={s} sort={sort} setSort={setSort} cutAfter={showCut ? 2 : -1} rank />
    </Card>
  )
}

function StandingsTableBody({
  rows,
  userTeam,
  s,
  sort,
  setSort,
  cutAfter,
  rank,
}: {
  rows: StandingsRow[]
  userTeam: string
  s: GameState
  sort: { key: SortKey; dir: 1 | -1 }
  setSort: (u: (p: { key: SortKey; dir: 1 | -1 }) => { key: SortKey; dir: 1 | -1 }) => void
  cutAfter: number
  rank?: boolean
}) {
  function th(key: SortKey, label: string) {
    return (
      <th
        className="sortable num"
        onClick={() => setSort((p) => ({ key, dir: p.key === key && p.dir === -1 ? 1 : -1 }))}
      >
        {label}
        {sort.key === key ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
      </th>
    )
  }
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 24 }}></th>
            <th>Team</th>
            {th('gp', 'GP')}
            {th('w', 'W')}
            {th('l', 'L')}
            {th('otl', 'OTL')}
            {th('pts', 'PTS')}
            {th('gf', 'GF')}
            {th('ga', 'GA')}
            {th('diff', 'DIFF')}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const t = s.teams[r.team]
            const isCut = cutAfter >= 0 && i === cutAfter - 1
            return (
              <tr key={r.team} className={`${r.team === userTeam ? 'me' : ''} ${isCut ? 'cutline' : ''}`}>
                <td className="muted num">{rank ? i + 1 : ''}</td>
                <td className="name-cell">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Crest team={t} size="mini" />
                    {t ? `${t.city} ${t.name}` : r.team}
                  </span>
                </td>
                <td className="num">{r.gp}</td>
                <td className="num">{r.w}</td>
                <td className="num">{r.l}</td>
                <td className="num">{r.otl}</td>
                <td className="num" style={{ fontWeight: 800 }}>
                  {r.pts}
                </td>
                <td className="num">{r.gf}</td>
                <td className="num">{r.ga}</td>
                <td className="num">{fmtSigned(r.gf - r.ga)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function sortRows(rows: StandingsRow[], sort: { key: SortKey; dir: 1 | -1 }): StandingsRow[] {
  const val = (r: StandingsRow): number => {
    switch (sort.key) {
      case 'diff':
        return r.gf - r.ga
      default:
        return r[sort.key]
    }
  }
  return [...rows].sort((a, b) => {
    const d = (val(a) - val(b)) * sort.dir
    if (d !== 0) return d
    // tiebreak: points then wins
    return b.pts - a.pts || b.w - a.w
  })
}

import { useMemo, useState } from 'react'
import type { GameState, Player } from '../types'
import { getStandings, getCapUsage, effectiveLines } from '../engine'
import { Modal, OvrBadge, PosTag, CapBar, ExpiryTag, Flag, TeamLogo, teamStyleVars } from './components'
import { PlayerModal } from './PlayerModal'
import { fmtM, fmtRecord, seasonLabel, posGroup, potArrow } from './format'
import { useUI } from './uiContext'

type SortKey = 'name' | 'pos' | 'age' | 'overall' | 'potential' | 'capHit'

const STRATEGY_LABEL: Record<GameState['teams'][string]['strategy'], string> = {
  contend: 'Contender',
  retool: 'Retooling',
  rebuild: 'Rebuilding',
}

/** Read-only scouting view of any team, reachable from links across the app. */
export function TeamViewer({ s, abbrev, onClose }: { s: GameState; abbrev: string; onClose: () => void }) {
  const { startTrade } = useUI()
  const team = s.teams[abbrev]
  const [sel, setSel] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'overall', dir: -1 })

  const cap = getCapUsage(s, abbrev)
  const row = useMemo(() => getStandings(s).league.find((r) => r.team === abbrev), [s, abbrev])

  if (!team) return null
  const isUser = abbrev === s.userTeam

  const selPlayer =
    sel != null ? team.roster.find((p) => p.id === sel) ?? team.prospects.find((p) => p.id === sel) : undefined

  const sorted = [...team.roster].sort((a, b) => cmp(a, b, sort.key, s) * sort.dir)
  const prospects = [...team.prospects].sort((a, b) => posGroup(a.pos) - posGroup(b.pos) || b.overall - a.overall)
  const picks = [...team.picks].sort((a, b) => a.year - b.year || a.round - b.round)

  function th(key: SortKey, label: string, num = false, cls = '') {
    const active = sort.key === key
    return (
      <th
        className={`sortable ${num ? 'num' : ''} ${cls}`}
        onClick={() => setSort((p) => ({ key, dir: p.key === key && p.dir === -1 ? 1 : -1 }))}
      >
        {label}
        {active ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
      </th>
    )
  }

  return (
    <>
      <Modal onClose={onClose} wide>
        <div style={teamStyleVars(team) as React.CSSProperties}>
          <div className="modal-head team-view-head">
            <TeamLogo
              team={team}
              size={44}
              fallback={<span className="crest" style={{ background: team.color }}>{team.abbrev}</span>}
            />
            <div className="modal-title">
              <h3>
                {team.city} {team.name}
              </h3>
              <div className="meta">
                {team.conference} · {team.division}
                {row && <> · {fmtRecord(row.w, row.l, row.otl)} · {row.pts} pts</>}
                <span className={`strat-chip strat-${team.strategy}`}>{STRATEGY_LABEL[team.strategy]}</span>
              </div>
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>

          <div className="modal-body">
            <CapBar used={cap.used} cap={cap.cap} capYear={cap.capYear} />

            {!isUser && (
              <div className="row" style={{ marginTop: 14 }}>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    startTrade(abbrev)
                    onClose()
                  }}
                >
                  Trade with {team.name} →
                </button>
              </div>
            )}

            <TeamLines s={s} abbrev={abbrev} />

            <div className="mini-title" style={{ marginTop: 16 }}>
              Roster · {team.roster.length}
            </div>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    {th('name', 'Player')}
                    {th('pos', 'Pos')}
                    {th('age', 'Age', true, 'm-hide')}
                    {th('overall', 'OVR', true)}
                    {th('potential', 'POT', true, 'm-hide')}
                    {th('capHit', 'Cap', true)}
                    <th>Exp</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p) => {
                    const pot = potArrow(p.overall, p.potential)
                    return (
                      <tr key={p.id} className="clickable" onClick={() => setSel(p.id)}>
                        <td className="name-cell">
                          {p.name}
                          {p.contract?.ntc && <span className="ntc-tag">NTC</span>} <Flag nat={p.nationality} />
                        </td>
                        <td>
                          <PosTag pos={p.pos} />
                        </td>
                        <td className="num m-hide">{p.age}</td>
                        <td className="num">
                          <OvrBadge overall={p.overall} />
                        </td>
                        <td className="num m-hide">
                          {p.potential}
                          <span className={pot.cls}> {pot.symbol}</span>
                        </td>
                        <td className="num">{p.contract ? fmtM(p.contract.capHit) : '—'}</td>
                        <td>{p.contract ? <ExpiryTag expiry={p.contract.expiry} /> : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mini-title" style={{ marginTop: 16 }}>
              Prospects · {prospects.length}
            </div>
            {prospects.length === 0 ? (
              <div className="hint">No prospects in the system.</div>
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <tbody>
                    {prospects.map((p) => (
                      <tr key={p.id} className="clickable" onClick={() => setSel(p.id)}>
                        <td className="name-cell">
                          {p.name} <Flag nat={p.nationality} />
                        </td>
                        <td>
                          <PosTag pos={p.pos} />
                        </td>
                        <td className="dim muted">{p.devLeague ?? '—'}</td>
                        <td className="num">{p.age}</td>
                        <td className="num">
                          <OvrBadge overall={p.overall} />
                        </td>
                        <td className="num muted">POT {p.potential}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mini-title" style={{ marginTop: 16 }}>
              Owned Picks · {picks.length}
            </div>
            {picks.length === 0 ? (
              <div className="hint">No draft picks owned.</div>
            ) : (
              <div className="chip-wrap">
                {picks.map((p, i) => (
                  <span key={`${p.year}-${p.round}-${p.originalTeam}-${i}`} className="tag">
                    {seasonLabel(p.year)} R{p.round}
                    {p.originalTeam !== p.owner ? ` (via ${p.originalTeam})` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {selPlayer && <PlayerModal s={s} player={selPlayer} team={abbrev} onClose={() => setSel(null)} />}
    </>
  )
}

const FWD_SLOT = ['LW', 'C', 'RW']
const DEF_SLOT = ['LD', 'RD']
const GOALIE_SLOT = ['S', 'B']

/** Read-only display of a team's current effective lineup (engine-resolved). */
function TeamLines({ s, abbrev }: { s: GameState; abbrev: string }) {
  const team = s.teams[abbrev]
  const eff = effectiveLines(s, abbrev)
  const byId = new Map(team.roster.map((p) => [p.id, p]))

  const chip = (id: string, pos: string, key: string) => {
    const p = id ? byId.get(id) : undefined
    return (
      <span className="line-slot" key={key}>
        <span className="slot-pos">{pos}</span>
        <span
          className={`lineup-chip readonly ${p ? '' : 'empty'}`}
          title={p ? `${p.name} · ${p.pos} · ${p.overall} OVR` : 'Empty slot'}
        >
          {p ? (
            <>
              <span className="chip-name">{p.name.split(' ').slice(-1)[0]}</span>
              <span className="chip-ovr">{p.overall}</span>
            </>
          ) : (
            <span className="chip-none">—</span>
          )}
        </span>
      </span>
    )
  }

  return (
    <details className="tv-lines" open>
      <summary className="mini-title">Lines</summary>
      <div className="lines-editor" style={{ marginTop: 8 }}>
        {[0, 1, 2, 3].map((i) => (
          <div className="line-group" key={`f${i}`}>
            <span className="line-label">L{i + 1}</span>
            {[0, 1, 2].map((j) => chip(eff.forwards[i]?.[j] ?? '', FWD_SLOT[j], `f${i}-${j}`))}
          </div>
        ))}
        {[0, 1, 2].map((i) => (
          <div className="line-group" key={`d${i}`}>
            <span className="line-label">P{i + 1}</span>
            {[0, 1].map((j) => chip(eff.defense[i]?.[j] ?? '', DEF_SLOT[j], `d${i}-${j}`))}
          </div>
        ))}
        <div className="line-group">
          <span className="line-label">G</span>
          {[0, 1].map((j) => chip(eff.goalies[j] ?? '', GOALIE_SLOT[j], `g${j}`))}
        </div>
      </div>
    </details>
  )
}

function cmp(a: Player, b: Player, key: SortKey, s: GameState): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'pos':
      return posGroup(a.pos) - posGroup(b.pos) || a.pos.localeCompare(b.pos)
    case 'age':
      return a.age - b.age
    case 'overall':
      return a.overall - b.overall
    case 'potential':
      return a.potential - b.potential
    case 'capHit':
      return (a.contract?.capHit ?? 0) - (b.contract?.capHit ?? 0)
    default:
      return 0
  }
}

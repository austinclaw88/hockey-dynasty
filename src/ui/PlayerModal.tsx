import { useMemo } from 'react'
import type { GameState, Player, CareerSeason, SeasonStatLine, FreeAgent } from '../types'
import { Modal, OvrBadge, ExpiryTag } from './components'
import { fmtM, fmtSigned, fmtGaa, fmtSvPct, potArrow, seasonLabel } from './format'
import { buildScoringLog, dayLabel } from './util'
import { useUI } from './uiContext'

export function PlayerModal({
  s,
  player,
  team,
  onClose,
  actions,
}: {
  s: GameState
  player: Player
  team?: string
  onClose: () => void
  /** optional action buttons (call up / send down etc.) */
  actions?: React.ReactNode
}) {
  const { whatWouldItTake } = useUI()
  const teamInfo = team ? s.teams[team] : undefined
  const line = s.stats[player.id]
  const isG = player.pos === 'G'
  const pot = potArrow(player.overall, player.potential)
  const asking = 'asking' in player ? (player as FreeAgent).asking : undefined
  const awayTeam = team && team !== s.userTeam ? team : undefined

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <span className="crest" style={{ background: teamInfo?.color ?? '#444' }}>
          {teamInfo?.abbrev ?? '—'}
        </span>
        <div className="modal-title">
          <h3>{player.name}</h3>
          <div className="meta">
            {player.pos} · Age {player.age} · Shoots {player.shoots}
            {player.nationality ? ` · ${player.nationality}` : ''}
            {player.injuryWeeks && player.injuryWeeks > 0 ? (
              <span className="ntc-tag" style={{ marginLeft: 8 }}>
                INJ {player.injuryWeeks}w
              </span>
            ) : null}
          </div>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="modal-body">
        <div className="kv">
          <div className="cell">
            <div className="k">Overall</div>
            <div className="v">
              <OvrBadge overall={player.overall} />
            </div>
          </div>
          <div className="cell">
            <div className="k">Potential</div>
            <div className="v">
              {player.potential} <span className={pot.cls}>{pot.symbol}</span>
            </div>
          </div>
          <div className="cell">
            <div className="k">Cap Hit</div>
            <div className="v">{player.contract ? fmtM(player.contract.capHit) : '—'}</div>
          </div>
          <div className="cell">
            <div className="k">Term</div>
            <div className="v">{player.contract ? `${player.contract.yearsLeft}yr` : '—'}</div>
          </div>
          <div className="cell">
            <div className="k">Expiry</div>
            <div className="v">
              {player.contract ? <ExpiryTag expiry={player.contract.expiry} /> : '—'}
            </div>
          </div>
          {asking && (
            <div className="cell">
              <div className="k">Asking</div>
              <div className="v">
                {fmtM(asking.capHit)} <span className="muted">× {asking.years}yr</span>
              </div>
            </div>
          )}
        </div>

        {!player.contract && !asking && (
          <div className="hint" style={{ marginBottom: 12 }}>Unsigned — no active contract.</div>
        )}

        {player.contract?.ntc && (
          <div className="notice" style={{ marginBottom: 12 }}>
            No-trade clause — this player must waive to be dealt.
          </div>
        )}

        <div className="mini-title">This Season</div>
        {line ? (
          isG ? (
            <div className="kv">
              <Stat k="GP" v={line.gp} />
              <Stat k="W" v={line.wins ?? 0} />
              <Stat k="L" v={line.losses ?? 0} />
              <Stat k="OTL" v={line.otl ?? 0} />
              <Stat k="SO" v={line.shutouts ?? 0} />
              <Stat k="GAA" v={fmtGaa(line.gaa)} />
              <Stat k="SV%" v={fmtSvPct(line.svPct)} />
            </div>
          ) : (
            <div className="kv">
              <Stat k="GP" v={line.gp} />
              <Stat k="G" v={line.goals} />
              <Stat k="A" v={line.assists} />
              <Stat k="PTS" v={line.points} />
              <Stat k="+/-" v={fmtSigned(line.plusMinus)} />
              <Stat k="PIM" v={line.pim} />
            </div>
          )
        ) : (
          <div className="hint">No games played yet this season.</div>
        )}

        <ScoringLog s={s} player={player} />

        <div className="mini-title">Career</div>
        <CareerTable s={s} player={player} team={team} />

        {awayTeam && (
          <div style={{ marginTop: 16 }}>
            <button
              className="btn btn-primary btn-block"
              onClick={() => whatWouldItTake(awayTeam, player.id)}
              title={`Ask ${teamInfo?.name ?? awayTeam} what it would take`}
            >
              💬 What would it take?
            </button>
          </div>
        )}

        {actions && <div style={{ marginTop: 16 }}>{actions}</div>}
      </div>
    </Modal>
  )
}

function CareerTable({ s, player, team }: { s: GameState; player: Player; team?: string }) {
  const isG = player.pos === 'G'
  const seasons = [...(s.careers[player.id] ?? [])].sort((a, b) => b.year - a.year)
  const current = s.stats[player.id]

  if (!current && seasons.length === 0) {
    return <div className="hint">No NHL seasons recorded yet.</div>
  }

  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          {isG ? (
            <tr>
              <th>Year</th>
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
              <th>Year</th>
              <th>Team</th>
              <th className="num">GP</th>
              <th className="num">G</th>
              <th className="num">A</th>
              <th className="num">P</th>
              <th className="num">+/-</th>
              <th className="num">PIM</th>
            </tr>
          )}
        </thead>
        <tbody>
          {current && (
            <CareerRow
              key="current"
              isG={isG}
              year={seasonLabel(s.seasonYear)}
              team={team ?? '—'}
              line={current}
              current
            />
          )}
          {seasons.map((cs, i) => (
            <CareerRow key={`${cs.year}-${i}`} isG={isG} year={seasonLabel(cs.year)} team={cs.team} line={cs} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CareerRow({
  isG,
  year,
  team,
  line,
  current,
}: {
  isG: boolean
  year: string
  team: string
  line: CareerSeason | SeasonStatLine
  current?: boolean
}) {
  return (
    <tr className={current ? 'me' : ''}>
      <td>
        {year}
        {current ? <span className="muted"> *</span> : ''}
      </td>
      <td>{team}</td>
      <td className="num">{line.gp}</td>
      {isG ? (
        <>
          <td className="num">{line.wins ?? 0}</td>
          <td className="num">{line.losses ?? 0}</td>
          <td className="num">{line.otl ?? 0}</td>
          <td className="num">{line.shutouts ?? 0}</td>
          <td className="num">{fmtGaa(line.gaa)}</td>
          <td className="num">{fmtSvPct(line.svPct)}</td>
        </>
      ) : (
        <>
          <td className="num">{line.goals}</td>
          <td className="num">{line.assists}</td>
          <td className="num" style={{ fontWeight: 700 }}>{line.points}</td>
          <td className="num">{fmtSigned(line.plusMinus)}</td>
          <td className="num">{line.pim}</td>
        </>
      )}
    </tr>
  )
}

function ScoringLog({ s, player }: { s: GameState; player: Player }) {
  const rows = useMemo(() => buildScoringLog(s, player.id), [s.schedule, player.id])
  if (rows.length === 0) return null
  return (
    <>
      <div className="mini-title">Scoring log</div>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Date</th>
              <th>Opp</th>
              <th className="num">G</th>
              <th className="num">A</th>
              <th className="num">PTS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.game.id}>
                <td>{dayLabel(r.game.day)}</td>
                <td>
                  <span className="ha">{r.home ? 'vs' : '@'}</span>
                  {r.opp}
                </td>
                <td className="num">{r.g}</td>
                <td className="num">{r.a}</td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {r.g + r.a}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="cell">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  )
}

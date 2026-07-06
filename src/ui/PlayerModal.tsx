import type { GameState, Player } from '../types'
import { Modal, OvrBadge, ExpiryTag } from './components'
import { fmtM, fmtSigned, fmtGaa, fmtSvPct, potArrow } from './format'

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
  const teamInfo = team ? s.teams[team] : undefined
  const line = s.stats[player.id]
  const isG = player.pos === 'G'
  const pot = potArrow(player.overall, player.potential)

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
        </div>

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

        {actions && <div className="row" style={{ marginTop: 16 }}>{actions}</div>}
      </div>
    </Modal>
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

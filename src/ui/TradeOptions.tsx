import { useEffect, useMemo } from 'react'
import type { GameState, DraftPick } from '../types'
import type { TradeOffer } from '../engine'
import { getTradeOptionsFor } from '../engine'
import { Modal, OvrBadge, PosTag, TeamLogo, TeamLink, PlayerLink } from './components'
import { buildPlayerIndex } from './util'
import { seasonLabel } from './format'
import { useUI } from './uiContext'

const pickKey = (p: DraftPick) => `${p.year}-${p.round}-${p.originalTeam}`

/**
 * Shows up to 3 AI trade packages (distinct partners) for one of the user's own
 * players. "Load this deal" hands the offer back to the caller to fill the
 * trade machine. If no fair package exists, toasts and closes on mount.
 */
export function TradeOptionsModal({
  s,
  playerId,
  onClose,
  onLoad,
}: {
  s: GameState
  playerId: string
  onClose: () => void
  onLoad: (offer: TradeOffer) => void
}) {
  const { pushToast } = useUI()
  const idx = useMemo(() => buildPlayerIndex(s), [s])
  const offers = useMemo(() => getTradeOptionsFor(s, playerId).slice(0, 3), [s, playerId])
  const subject = idx.get(playerId)?.player

  useEffect(() => {
    if (offers.length === 0) {
      pushToast('error', 'No team is offering fair value right now.')
      onClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offers.length])

  if (offers.length === 0) return null

  return (
    <Modal onClose={onClose} wide>
      <div className="modal-head">
        <div className="modal-title">
          <h3>Trade offers for {subject?.name ?? 'player'}</h3>
          <div className="meta">Top packages from interested teams — load one to review or execute.</div>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="modal-body">
        <div className="trade-options">
          {offers.map((o, i) => {
            const partner = s.teams[o.to]
            return (
              <div className="offer-card" key={i}>
                <div className="offer-head">
                  <TeamLink abbrev={o.to} title="View team">
                    <TeamLogo team={partner} size={26} />
                    <strong>
                      {partner?.city} {partner?.name}
                    </strong>
                  </TeamLink>
                </div>
                <div className="offer-body">
                  <div className="offer-side">
                    <div className="offer-label give">You give</div>
                    <AssetList players={o.fromPlayers} picks={o.fromPicks} idx={idx} />
                  </div>
                  <div className="offer-arrow">⇄</div>
                  <div className="offer-side">
                    <div className="offer-label get">You get</div>
                    <AssetList players={o.toPlayers} picks={o.toPicks} idx={idx} />
                  </div>
                </div>
                <div className="offer-actions row">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      onLoad(o)
                      onClose()
                    }}
                  >
                    Load this deal →
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

function AssetList({
  players,
  picks,
  idx,
}: {
  players: string[]
  picks: DraftPick[]
  idx: ReturnType<typeof buildPlayerIndex>
}) {
  if (players.length === 0 && picks.length === 0) return <div className="hint">Nothing.</div>
  return (
    <div className="asset-list">
      {players.map((id) => {
        const ref = idx.get(id)
        const p = ref?.player
        return (
          <div className="asset-mini" key={id}>
            {p ? (
              <>
                <PosTag pos={p.pos} />
                <PlayerLink id={id} player={p} team={ref?.team} className="a-name">
                  {p.name}
                </PlayerLink>
                <OvrBadge overall={p.overall} />
              </>
            ) : (
              <span className="a-name">{id}</span>
            )}
          </div>
        )
      })}
      {picks.map((p, i) => (
        <div className="asset-mini" key={`${pickKey(p)}-${i}`}>
          <span className="tag">
            {seasonLabel(p.year)} R{p.round}
          </span>
          {p.originalTeam !== p.owner && <span className="strength">via {p.originalTeam}</span>}
        </div>
      ))}
    </div>
  )
}

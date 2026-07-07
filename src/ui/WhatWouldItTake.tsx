import { useMemo } from 'react'
import type { GameState, DraftPick } from '../types'
import type { TradeOffer } from '../engine'
import { getAiTradeSuggestionFor, evaluateTrade } from '../engine'
import { Modal, OvrBadge, PosTag, TeamLogo } from './components'
import { buildPlayerIndex } from './util'
import { seasonLabel } from './format'

const pickKey = (p: DraftPick) => `${p.year}-${p.round}-${p.originalTeam}`

/**
 * "What would it take?" — asks the engine what the partner GM would want in
 * exchange for one of their players, and shows the ask plus a realism read.
 */
export function WhatWouldItTakeModal({
  s,
  partner,
  playerId,
  onClose,
  onLoad,
}: {
  s: GameState
  partner: string
  playerId: string
  onClose: () => void
  onLoad: (offer: TradeOffer) => void
}) {
  const idx = useMemo(() => buildPlayerIndex(s), [s])
  const offer = useMemo(() => getAiTradeSuggestionFor(s, partner, playerId), [s, partner, playerId])
  const partnerTeam = s.teams[partner]
  const subject = idx.get(playerId)?.player

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <TeamLogo
          team={partnerTeam}
          size={34}
          fallback={<span className="crest" style={{ background: partnerTeam?.color ?? '#444' }}>{partner}</span>}
        />
        <div className="modal-title">
          <h3>Trade inquiry{subject ? `: ${subject.name}` : ''}</h3>
          <div className="meta">{partnerTeam?.name ?? partner}’s asking price:</div>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="modal-body">
        {!offer ? (
          <div className="notice">They consider him untouchable right now.</div>
        ) : (
          <WwitBody s={s} offer={offer} idx={idx} partner={partner} onLoad={onLoad} onClose={onClose} />
        )}
      </div>
    </Modal>
  )
}

function WwitBody({
  s,
  offer,
  idx,
  partner,
  onLoad,
  onClose,
}: {
  s: GameState
  offer: TradeOffer
  idx: ReturnType<typeof buildPlayerIndex>
  partner: string
  onLoad: (offer: TradeOffer) => void
  onClose: () => void
}) {
  const partnerTeam = s.teams[partner]
  const verdict = useMemo(() => evaluateTrade(s, offer), [s, offer])
  // `offer` is from the USER's perspective: fromPlayers/fromPicks are what the
  // user must pay the partner — i.e. what the partner would want.
  const wantPlayers = offer.fromPlayers
  const wantPicks = offer.fromPicks
  return (
    <>
      <div className="mini-title">In return, {partnerTeam?.name ?? partner} would want:</div>
      <div className="wwit-assets">
        {wantPlayers.length === 0 && wantPicks.length === 0 ? (
          <div className="hint">Just a roster spot — they’d take futures.</div>
        ) : (
          <div className="asset-list">
            {wantPlayers.map((id) => {
              const p = idx.get(id)?.player
              return (
                <div className="asset-mini" key={id}>
                  {p ? (
                    <>
                      <PosTag pos={p.pos} />
                      <span className="a-name">{p.name}</span>
                      <OvrBadge overall={p.overall} />
                    </>
                  ) : (
                    <span className="a-name">{id}</span>
                  )}
                </div>
              )
            })}
            {wantPicks.map((p, i) => (
              <div className="asset-mini" key={`${pickKey(p)}-${i}`}>
                <span className="tag">
                  {seasonLabel(p.year)} R{p.round}
                </span>
                {p.originalTeam !== p.owner && <span className="strength">via {p.originalTeam}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="wwit-verdict">
        <span className="k">Realism</span>
        <span className={`verdict-text ${verdict.accept ? 'accept' : 'close'}`}>{verdict.verdict}</span>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btn btn-primary btn-lg"
          onClick={() => {
            onLoad(offer)
            onClose()
          }}
        >
          Load in Trade Machine →
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  )
}

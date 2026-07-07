import { useState } from 'react'
import type { GameState, Player } from '../types'
import { extendPlayer } from '../engine'
import { Modal, OvrBadge, PosTag } from './components'
import { fmtM } from './format'
import { SliderField, NtcToggle, NegotiationFeedback } from './negotiation'
import { useUI } from './uiContext'

/**
 * Mid-season contract extension for a user player in the final year of his deal.
 * Reuses the shared negotiation controls + live acceptance meter (getSigningPreview)
 * and commits via extendPlayer.
 */
export function ExtensionModal({
  s,
  player,
  apply,
  onClose,
}: {
  s: GameState
  player: Player
  apply: (n: GameState) => void
  onClose: () => void
}) {
  const { pushToast } = useUI()
  const [years, setYears] = useState(3)
  const [capHit, setCapHit] = useState(player.contract?.capHit ?? 1)
  const [ntc, setNtc] = useState(player.contract?.ntc ?? false)
  const [notice, setNotice] = useState<string | null>(null)

  function offer() {
    const r = extendPlayer(s, player.id, years, capHit, ntc)
    if (r.ok) {
      apply(r.s)
      pushToast('success', `Extended ${player.name} — ${fmtM(capHit)} × ${years}yr.`)
      onClose()
    } else {
      const msg = r.reason ?? `${player.name} turned down the extension.`
      setNotice(msg)
      pushToast('error', msg)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">
          <h3>Extend {player.name}</h3>
          <div className="meta">
            <PosTag pos={player.pos} /> · Age {player.age} · <OvrBadge overall={player.overall} /> · Current{' '}
            {player.contract ? `${fmtM(player.contract.capHit)} (expiring)` : '—'}
          </div>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="modal-body">
        <div className="stack">
          <div className="hint">Lock him up now, before he can reach unrestricted free agency this summer.</div>
          <SliderField label={`Cap Hit — ${fmtM(capHit)}`} min={0.775} max={17} step={0.05} value={capHit} onChange={setCapHit} />
          <SliderField label={`Years — ${years}`} min={1} max={8} step={1} value={years} onChange={setYears} />
          <div className="nego-panel">
            <NtcToggle ntc={ntc} onChange={setNtc} />
            <NegotiationFeedback s={s} playerId={player.id} years={years} capHit={capHit} ntc={ntc} />
          </div>
          {notice && <div className="notice err">{notice}</div>}
          <div className="row">
            <button className="btn btn-primary btn-lg" onClick={offer}>Offer Extension</button>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

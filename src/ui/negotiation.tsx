// Shared contract-negotiation controls, reused by the offseason re-sign step,
// free-agency offers, and mid-season extensions. All driven by the engine's
// getSigningPreview so the acceptance read is identical everywhere.
import type { GameState } from '../types'
import { getSigningPreview } from '../engine'
import { fmtM } from './format'

export type Verdict = 'certain' | 'likely' | 'coin flip' | 'unlikely' | 'rejected'
export const VERDICT_ORDER: Verdict[] = ['certain', 'likely', 'coin flip', 'unlikely', 'rejected']

/** A labeled slider control (cap hit / years). */
export function SliderField({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (n: number) => void
}) {
  return (
    <div className="field" style={{ minWidth: 180, flex: 1 }}>
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

/** A styled "include no-trade clause" switch with helper text. */
export function NtcToggle({ ntc, onChange }: { ntc: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ntc-switch">
      <span className={`switch ${ntc ? 'on' : ''}`} role="switch" aria-checked={ntc}>
        <input type="checkbox" checked={ntc} onChange={(e) => onChange(e.target.checked)} />
        <span className="knob" />
      </span>
      <span className="ntc-switch-text">
        <span className="ntc-switch-label">Include no-trade clause</span>
        <span className="hint">Sweetens the deal — veterans may accept less money.</span>
      </span>
    </label>
  )
}

/** 5-state acceptance meter, color coded green → red. */
export function AcceptanceMeter({ verdict }: { verdict: Verdict }) {
  const idx = VERDICT_ORDER.indexOf(verdict)
  return (
    <div className="accept-meter" data-verdict={verdict}>
      <div className="accept-segs" aria-hidden>
        {VERDICT_ORDER.map((v, i) => (
          <span key={v} className={`seg seg-${i} ${i === idx ? 'active' : ''}`} />
        ))}
      </div>
      <div className="accept-label">{verdict}</div>
    </div>
  )
}

/** Live signing feedback: effective ask + acceptance meter for the current offer. */
export function NegotiationFeedback({
  s,
  playerId,
  years,
  capHit,
  ntc,
}: {
  s: GameState
  playerId: string
  years: number
  capHit: number
  ntc: boolean
}) {
  const preview = getSigningPreview(s, playerId, years, capHit, ntc)
  return (
    <div className="nego-feedback">
      <div className="nego-ask">
        <span className="k">Effective ask</span>
        <span className="v">
          {fmtM(preview.effectiveAsk)} × {years}yr
          {ntc && <span className="ntc-tag">NTC</span>}
        </span>
      </div>
      <AcceptanceMeter verdict={preview.verdict as Verdict} />
    </div>
  )
}

// Free-agent signing + offer-sheet UI, shared by the offseason Free Agency
// step, the in-season Players tab, and the Dashboard. Keeps the offer/offer-sheet
// modals, the RFA draft-pick compensation helpers, and the incoming-offer-sheet
// alert panel in one place so the signing experience is identical everywhere.
import { useState } from 'react'
import type { GameState, FreeAgent, PendingOfferSheet, Player } from '../types'
import { ROSTER_MIN, ROSTER_MAX } from '../types'
import { signFreeAgent, tenderOfferSheet, respondToOfferSheet } from '../engine'
import { Modal, TeamLogo } from './components'
import { fmtM } from './format'
import { SliderField, NtcToggle, NegotiationFeedback } from './negotiation'
import { buildPlayerIndex, rosterCounts } from './util'
import { useUI } from './uiContext'

// ---------------- Roster completeness ----------------

const REQ = { f: 12, d: 6, g: 2 } as const

export interface RosterStatus {
  counts: { f: number; d: number; g: number; total: number }
  /** Position shortfalls vs the league minimums, e.g. ["1 F", "1 G"]. */
  needs: string[]
  belowMin: boolean
  overMax: boolean
  tone: 'good' | 'warn' | 'bad'
}

/** Roster legality snapshot: minimums are 20 total (12 F, 6 D, 2 G), max 23. */
export function rosterStatus(roster: Player[]): RosterStatus {
  const counts = rosterCounts(roster)
  const needs: string[] = []
  if (counts.f < REQ.f) needs.push(`${REQ.f - counts.f} F`)
  if (counts.d < REQ.d) needs.push(`${REQ.d - counts.d} D`)
  if (counts.g < REQ.g) needs.push(`${REQ.g - counts.g} G`)
  const belowMin = needs.length > 0 || counts.total < ROSTER_MIN
  const overMax = counts.total > ROSTER_MAX
  const tone: RosterStatus['tone'] = belowMin || overMax ? 'bad' : counts.total >= ROSTER_MAX ? 'good' : 'warn'
  return { counts, needs, belowMin, overMax, tone }
}

/** Join needs into prose: ["1 F","1 G"] -> "1 F and 1 G". */
export function needsList(needs: string[]): string {
  if (needs.length === 0) return ''
  if (needs.length === 1) return needs[0]
  if (needs.length === 2) return `${needs[0]} and ${needs[1]}`
  return `${needs.slice(0, -1).join(', ')} and ${needs[needs.length - 1]}`
}

/** Persistent roster-legality strip for the Free Agency step / Dashboard FA card. */
export function RosterStatusStrip({ roster }: { roster: Player[] }) {
  const st = rosterStatus(roster)
  const { counts, needs } = st
  const msg =
    needs.length > 0
      ? `need ${needsList(needs)} to reach the ${ROSTER_MIN}-man minimum`
      : st.overMax
        ? `over the ${ROSTER_MAX}-man max by ${counts.total - ROSTER_MAX}`
        : counts.total >= ROSTER_MAX
          ? 'roster is full and legal'
          : `legal — room for ${ROSTER_MAX - counts.total} more`
  return (
    <div className={`roster-status roster-status-${st.tone}`} role="status">
      <span className="roster-status-counts">
        {counts.total}/{ROSTER_MAX} · F {counts.f}/{REQ.f} · D {counts.d}/{REQ.d} · G {counts.g}/{REQ.g}
      </span>
      <span className="roster-status-msg">— {msg}</span>
    </div>
  )
}

// ---------------- Draft-pick compensation ----------------

/**
 * Draft-pick compensation rounds owed for an offer-sheet AAV, mirroring the
 * engine's tiers:
 *   < $1.5M  none · $1.5-3M 3rd · $3-4.5M 2nd · $4.5-7M 1st ·
 *   $7-9M 1st+3rd · > $9M 1st+2nd+3rd
 */
export function compensationRounds(aav: number): number[] {
  if (aav < 1.5) return []
  if (aav < 3) return [3]
  if (aav < 4.5) return [2]
  if (aav < 7) return [1]
  if (aav < 9) return [1, 3]
  return [1, 2, 3]
}

function roundLabel(r: number): string {
  return r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`
}

/** Human compensation summary, e.g. "2027 1st + 3rd" or "No compensation". */
/** Whether the user owns the picks required to sheet this player at his ask. */
export function canAffordSheet(s: GameState, fa: FreeAgent): boolean {
  const rounds = compensationRounds(fa.asking.capHit)
  if (rounds.length === 0) return true
  const owned = s.teams[s.userTeam].picks.filter((p) => p.owner === s.userTeam)
  const used = new Set<number>()
  for (const r of rounds) {
    const idx = owned.findIndex((p, i) => p.round === r && !used.has(i))
    if (idx === -1) return false
    used.add(idx)
  }
  return true
}

export function compensationLabel(aav: number, draftYear: number): string {
  const rounds = compensationRounds(aav)
  if (rounds.length === 0) return 'No compensation'
  return `${draftYear} ${rounds.map(roundLabel).join(' + ')}`
}

/** Boxed compensation-tier preview + match warning shown inside the offer sheet. */
function CompensationPreview({ capHit, draftYear, teamName }: { capHit: number; draftYear: number; teamName: string }) {
  const rounds = compensationRounds(capHit)
  return (
    <div className="comp-preview">
      <div className="comp-preview-head">Draft-pick compensation</div>
      <div className="comp-preview-picks">
        {rounds.length === 0 ? (
          <span className="comp-none">None at this AAV</span>
        ) : (
          rounds.map((r) => (
            <span className="comp-pick" key={r}>
              {draftYear} {roundLabel(r)}
            </span>
          ))
        )}
      </div>
      <div className="comp-preview-warn">If {teamName} declines to match, you pay this compensation.</div>
    </div>
  )
}

// ---------------- UFA / in-season signing modal ----------------

/** Standard free-agent signing modal (negotiation meter + optional NTC). */
export function OfferModal({
  s,
  fa,
  onClose,
  onSubmit,
}: {
  s: GameState
  fa: FreeAgent
  onClose: () => void
  onSubmit: (years: number, capHit: number, ntc: boolean) => void
}) {
  const [years, setYears] = useState(fa.asking.years)
  const [capHit, setCapHit] = useState(fa.asking.capHit)
  const [ntc, setNtc] = useState(false)
  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">
          <h3>{fa.name}</h3>
          <div className="meta">
            {fa.pos} · Age {fa.age} · {fa.overall} OVR · Asking {fmtM(fa.asking.capHit)} × {fa.asking.years}yr
          </div>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <div className="stack">
          <SliderField label={`Cap Hit — ${fmtM(capHit)}`} min={0.775} max={17} step={0.05} value={capHit} onChange={setCapHit} />
          <SliderField label={`Years — ${years}`} min={1} max={8} step={1} value={years} onChange={setYears} />
          <div className="nego-panel">
            <NtcToggle ntc={ntc} onChange={setNtc} />
            <NegotiationFeedback s={s} playerId={fa.id} years={years} capHit={capHit} ntc={ntc} />
          </div>
          <div className="hint">Offer at or above the effective ask to land the player. Lowballs may be rejected.</div>
          <div className="row">
            <button className="btn btn-primary btn-lg" onClick={() => onSubmit(years, capHit, ntc)}>
              Submit Offer
            </button>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ---------------- RFA offer-sheet modal ----------------

/** Offer-sheet modal for an RFA whose rights another team holds. Same
 *  negotiation meter (NTC hidden) plus a prominent compensation preview. */
export function OfferSheetModal({
  s,
  fa,
  onClose,
  onSubmit,
}: {
  s: GameState
  fa: FreeAgent
  onClose: () => void
  onSubmit: (years: number, capHit: number) => void
}) {
  const [years, setYears] = useState(fa.asking.years)
  const [capHit, setCapHit] = useState(fa.asking.capHit)
  const rightsTeam = fa.rightsTeam ? s.teams[fa.rightsTeam] : undefined
  const teamName = rightsTeam?.name ?? fa.rightsTeam ?? 'the rights holder'
  const draftYear = s.seasonYear + 1
  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">
          <h3>{fa.name}</h3>
          <div className="meta">
            {fa.pos} · Age {fa.age} · {fa.overall} OVR · Asking {fmtM(fa.asking.capHit)} × {fa.asking.years}yr
          </div>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <div className="stack">
          <div className="offer-sheet-tag">
            <span className="tag rfa">RFA</span>
            <span className="hint">
              Rights held by{' '}
              <span className="offer-sheet-rights">
                <TeamLogo team={rightsTeam} size={16} />
                {fa.rightsTeam}
              </span>{' '}
              — an offer sheet they can match.
            </span>
          </div>
          <SliderField label={`Cap Hit — ${fmtM(capHit)}`} min={0.775} max={17} step={0.05} value={capHit} onChange={setCapHit} />
          <SliderField label={`Years — ${years}`} min={1} max={8} step={1} value={years} onChange={setYears} />
          <div className="nego-panel">
            <NegotiationFeedback s={s} playerId={fa.id} years={years} capHit={capHit} ntc={false} />
          </div>
          <CompensationPreview capHit={capHit} draftYear={draftYear} teamName={teamName} />
          <div className="row">
            <button className="btn btn-primary btn-lg" onClick={() => onSubmit(years, capHit)}>
              Submit Offer Sheet
            </button>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Fire a tendered offer sheet and toast the outcome. Shared by every screen
 *  that can tender one so the messaging stays consistent. */
export function submitOfferSheet(
  s: GameState,
  fa: FreeAgent,
  years: number,
  capHit: number,
  apply: (n: GameState) => void,
  pushToast: (kind: 'success' | 'error', text: string) => void,
): boolean {
  const r = tenderOfferSheet(s, fa.id, years, capHit)
  if (!r.ok) {
    pushToast('error', r.reason ?? `The offer sheet for ${fa.name} was rejected.`)
    return false
  }
  apply(r.s)
  const rightsAbbrev = fa.rightsTeam ?? 'The team'
  if (r.matched) {
    pushToast('success', `${rightsAbbrev} matched the offer sheet.`)
  } else {
    const comp = compensationLabel(capHit, s.seasonYear + 1)
    pushToast('success', comp === 'No compensation' ? `Signed ${fa.name}! No compensation owed.` : `Signed! Compensation sent: ${comp}.`)
  }
  return true
}

// ---------------- Incoming offer sheets (your RFAs) ----------------

/** High-stakes alert panel: offer sheets rival GMs have tendered to the user's
 *  own restricted free agents. Rendered in the FA step and on the Dashboard. */
export function IncomingSheetsPanel({ s, apply }: { s: GameState; apply: (n: GameState) => void }) {
  const sheets = s.pendingSheets ?? []
  if (sheets.length === 0) return null
  return (
    <div className="offer-sheet-alerts">
      <div className="offer-sheet-alerts-head">
        <span className="offer-sheet-alerts-siren" aria-hidden>
          ⚠
        </span>
        <span>
          {sheets.length === 1 ? 'An offer sheet' : `${sheets.length} offer sheets`} tendered to your restricted free
          {sheets.length === 1 ? ' agent' : ' agents'}
        </span>
      </div>
      {sheets.map((sheet) => (
        <IncomingSheetCard key={sheet.id} s={s} apply={apply} sheet={sheet} />
      ))}
    </div>
  )
}

function IncomingSheetCard({ s, apply, sheet }: { s: GameState; apply: (n: GameState) => void; sheet: PendingOfferSheet }) {
  const { pushToast } = useUI()
  const [confirm, setConfirm] = useState<null | 'match' | 'let'>(null)
  const idx = buildPlayerIndex(s)
  const player = idx.get(sheet.playerId)?.player
  const name = player?.name ?? 'Your player'
  const fromTeam = s.teams[sheet.from]
  const fromName = fromTeam?.name ?? sheet.from
  const comp = compensationLabel(sheet.capHit, s.seasonYear + 1)
  const edgeStyle = { ['--sheet-color' as string]: fromTeam?.color ?? '#e5534b' } as React.CSSProperties

  function respond(match: boolean) {
    const r = respondToOfferSheet(s, sheet.id, match)
    if (r.ok) {
      apply(r.s)
      if (match) pushToast('success', `Matched — ${name} stays with your club.`)
      else pushToast('success', `${name} signs with ${sheet.from}. You receive ${comp}.`)
    } else {
      pushToast('error', r.reason ?? 'Could not respond to the offer sheet.')
    }
    setConfirm(null)
  }

  return (
    <div className="offer-sheet-card" style={edgeStyle}>
      <div className="offer-sheet-card-main">
        <TeamLogo team={fromTeam} size={30} fallback={<span className="mini-crest" style={{ background: fromTeam?.color ?? '#444' }}>{sheet.from}</span>} />
        <div className="offer-sheet-card-body">
          <div className="offer-sheet-card-line">
            <strong>{fromName}</strong> has tendered an offer sheet
          </div>
          <div className="offer-sheet-card-terms">
            <span className="offer-sheet-player">{name}</span>
            <span className="offer-sheet-money">
              {fmtM(sheet.capHit)} × {sheet.years}
            </span>
          </div>
          <div className="offer-sheet-card-comp">Decline compensation: {comp}</div>
        </div>
      </div>
      <div className="offer-sheet-card-actions">
        <button className="btn btn-primary" onClick={() => setConfirm('match')}>
          Match
        </button>
        <button className="btn btn-danger" onClick={() => setConfirm('let')}>
          Let him go
        </button>
      </div>

      {confirm && (
        <Modal onClose={() => setConfirm(null)}>
          <div className="modal-head">
            <div className="modal-title">
              <h3>{confirm === 'match' ? `Match the offer for ${name}?` : `Let ${name} walk?`}</h3>
              <div className="meta">
                {fromName} · {fmtM(sheet.capHit)} × {sheet.years}yr
              </div>
            </div>
            <button className="modal-close" onClick={() => setConfirm(null)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="modal-body">
            <div className="stack">
              {confirm === 'match' ? (
                <div className="hint">
                  You re-sign {name} at {fmtM(sheet.capHit)} × {sheet.years}yr — the exact terms of the sheet. The deal
                  must fit under your cap.
                </div>
              ) : (
                <div className="notice">
                  {name} leaves for {fromName}. In return you receive{' '}
                  <strong>{comp === 'No compensation' ? 'no draft compensation' : comp}</strong>.
                </div>
              )}
              <div className="row">
                <button className={`btn btn-lg ${confirm === 'match' ? 'btn-primary' : 'btn-danger'}`} onClick={() => respond(confirm === 'match')}>
                  {confirm === 'match' ? 'Confirm Match' : 'Confirm — let him go'}
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

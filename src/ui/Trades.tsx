import { useMemo, useState } from 'react'
import type { GameState, Player, DraftPick } from '../types'
import type { TradeOffer } from '../engine'
import { evaluateTrade, executeTrade, getAiTradeSuggestion } from '../engine'
import { Card, OvrBadge, PosTag } from './components'
import { fmtM, seasonLabel } from './format'

const DEADLINE_DAY = 120
const pickKey = (p: DraftPick) => `${p.year}-${p.round}-${p.originalTeam}`

function tradingAllowed(s: GameState): { ok: boolean; reason?: string } {
  if (s.phase === 'regular') {
    if (s.day >= DEADLINE_DAY)
      return { ok: false, reason: 'The trade deadline (day 120) has passed. Trades reopen in the offseason free-agency window.' }
    return { ok: true }
  }
  if (s.phase === 'offseason' && s.offseasonStep === 'freeAgency') return { ok: true }
  return { ok: false, reason: 'Trades are only available during the regular season (before the deadline) and the offseason free-agency window.' }
}

const STRATEGY_HINT: Record<GameState['teams'][string]['strategy'], string> = {
  contend: 'Contender — wants proven, win-now talent and will move picks & prospects.',
  retool: 'Retooling — open to hockey trades that balance now and later.',
  rebuild: 'Rebuilding — hunting for picks, prospects and young players; will move veterans.',
}

export function Trades({ s, apply }: { s: GameState; apply: (n: GameState) => void }) {
  const allowed = tradingAllowed(s)
  const others = Object.keys(s.teams)
    .filter((a) => a !== s.userTeam)
    .sort((a, b) => `${s.teams[a].city}`.localeCompare(s.teams[b].city))
  const [partner, setPartner] = useState<string>(others[0] ?? '')
  const [fromPlayers, setFromPlayers] = useState<Set<string>>(new Set())
  const [toPlayers, setToPlayers] = useState<Set<string>>(new Set())
  const [fromPicks, setFromPicks] = useState<Set<string>>(new Set())
  const [toPicks, setToPicks] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const userTeam = s.teams[s.userTeam]
  const partnerTeam = partner ? s.teams[partner] : undefined

  function reset() {
    setFromPlayers(new Set())
    setToPlayers(new Set())
    setFromPicks(new Set())
    setToPicks(new Set())
  }

  const offer: TradeOffer | null = useMemo(() => {
    if (!partner || !partnerTeam) return null
    const upicks = userTeam.picks.filter((p) => fromPicks.has(pickKey(p)))
    const ppicks = partnerTeam.picks.filter((p) => toPicks.has(pickKey(p)))
    return {
      from: s.userTeam,
      to: partner,
      fromPlayers: [...fromPlayers],
      toPlayers: [...toPlayers],
      fromPicks: upicks,
      toPicks: ppicks,
    }
  }, [partner, partnerTeam, fromPlayers, toPlayers, fromPicks, toPicks, s.userTeam, userTeam.picks])

  const hasAssets = offer != null && (offer.fromPlayers.length + offer.fromPicks.length > 0 || offer.toPlayers.length + offer.toPicks.length > 0)
  const evalResult = offer && allowed.ok && hasAssets ? safeEval(s, offer) : null

  function askAi() {
    if (!partner) return
    const sug = getAiTradeSuggestion(s, partner)
    if (!sug) {
      setNotice({ kind: 'err', text: `${partnerTeam?.name ?? partner} has no obvious trade to offer right now.` })
      return
    }
    setNotice(null)
    setFromPlayers(new Set(sug.fromPlayers))
    setToPlayers(new Set(sug.toPlayers))
    setFromPicks(new Set(sug.fromPicks.map(pickKey)))
    setToPicks(new Set(sug.toPicks.map(pickKey)))
  }

  function execute() {
    if (!offer) return
    const r = executeTrade(s, offer)
    if (r.ok) {
      apply(r.s)
      reset()
      setNotice({ kind: 'ok', text: 'Trade completed.' })
    } else {
      setNotice({ kind: 'err', text: r.reason ?? 'Trade rejected.' })
    }
  }

  return (
    <div className="stack">
      {!allowed.ok && <div className="notice">{allowed.reason}</div>}

      <Card title="Trade Partner">
        <div className="card-pad">
          <div className="row">
            <select value={partner} onChange={(e) => { setPartner(e.target.value); reset(); setNotice(null) }}>
              {others.map((a) => (
                <option key={a} value={a}>
                  {s.teams[a].city} {s.teams[a].name}
                </option>
              ))}
            </select>
            <button className="btn" disabled={!allowed.ok} onClick={askAi}>
              Ask AI for an offer
            </button>
            <div className="spacer" />
            <button className="btn btn-ghost" onClick={() => { reset(); setNotice(null) }}>
              Clear
            </button>
          </div>
          {partnerTeam && (
            <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
              {STRATEGY_HINT[partnerTeam.strategy]}
            </p>
          )}
        </div>
      </Card>

      <div className="trade-cols">
        <AssetColumn
          title={`${userTeam.name} send`}
          team={userTeam}
          selPlayers={fromPlayers}
          selPicks={fromPicks}
          togglePlayer={(id) => setFromPlayers((p) => toggle(p, id))}
          togglePick={(k) => setFromPicks((p) => toggle(p, k))}
        />
        <AssetColumn
          title={`${partnerTeam?.name ?? 'Partner'} send`}
          team={partnerTeam}
          selPlayers={toPlayers}
          selPicks={toPicks}
          togglePlayer={(id) => setToPlayers((p) => toggle(p, id))}
          togglePick={(k) => setToPicks((p) => toggle(p, k))}
        />
      </div>

      <Card title="Verdict">
        <div className="card-pad">
          {!hasAssets ? (
            <div className="hint">Add players or picks to both sides to gauge the deal.</div>
          ) : evalResult ? (
            <>
              <div className={`verdict-text ${verdictClass(evalResult)}`}>{evalResult.verdict}</div>
              <div className="verdict-meter">
                <span className="marker" style={{ left: `${markerPos(evalResult)}%` }} />
              </div>
              <div className="cap-legend">
                <span>Rejected</span>
                <span>Fair</span>
                <span>Accepted</span>
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn btn-primary btn-lg" disabled={!allowed.ok || !evalResult.accept} onClick={execute}>
                  {evalResult.accept ? 'Execute Trade' : 'They Won’t Accept'}
                </button>
                {!evalResult.accept && <span className="hint">Sweeten the package to get it over the line.</span>}
              </div>
            </>
          ) : (
            <div className="hint">Trades are closed right now.</div>
          )}
          {notice && (
            <div className={`notice ${notice.kind === 'err' ? 'err' : ''}`} style={{ marginTop: 14 }}>
              {notice.text}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

function AssetColumn({
  title,
  team,
  selPlayers,
  selPicks,
  togglePlayer,
  togglePick,
}: {
  title: string
  team: GameState['teams'][string] | undefined
  selPlayers: Set<string>
  selPicks: Set<string>
  togglePlayer: (id: string) => void
  togglePick: (k: string) => void
}) {
  if (!team) return <Card title={title}><div className="news-empty">Pick a partner.</div></Card>
  const roster = [...team.roster].sort((a, b) => b.overall - a.overall)
  const prospects = [...team.prospects].sort((a, b) => b.overall - a.overall)
  const picks = [...team.picks].sort((a, b) => a.year - b.year || a.round - b.round)
  return (
    <Card title={title}>
      <div style={{ maxHeight: 460, overflowY: 'auto' }}>
        <div className="group-label">Roster</div>
        {roster.map((p) => (
          <PlayerAsset key={p.id} p={p} checked={selPlayers.has(p.id)} onToggle={() => togglePlayer(p.id)} />
        ))}
        {prospects.length > 0 && (
          <>
            <div className="group-label">Prospects</div>
            {prospects.map((p) => (
              <PlayerAsset key={p.id} p={p} checked={selPlayers.has(p.id)} onToggle={() => togglePlayer(p.id)} />
            ))}
          </>
        )}
        {picks.length > 0 && (
          <>
            <div className="group-label">Draft Picks</div>
            {picks.map((p) => {
              const k = pickKey(p)
              return (
                <label key={k} className={`asset ${selPicks.has(k) ? 'sel' : ''}`}>
                  <input type="checkbox" checked={selPicks.has(k)} onChange={() => togglePick(k)} />
                  <span className="a-name">
                    {seasonLabel(p.year)} · Round {p.round}
                  </span>
                  <span className="strength">{p.originalTeam !== p.owner ? `via ${p.originalTeam}` : ''}</span>
                </label>
              )
            })}
          </>
        )}
      </div>
    </Card>
  )
}

function PlayerAsset({ p, checked, onToggle }: { p: Player; checked: boolean; onToggle: () => void }) {
  return (
    <label className={`asset ${checked ? 'sel' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <PosTag pos={p.pos} />
      <span className="a-name">
        {p.name}
        {p.contract?.ntc && <span className="ntc-tag">NTC</span>}
      </span>
      <span className="strength">{p.contract ? fmtM(p.contract.capHit) : '—'}</span>
      <OvrBadge overall={p.overall} />
    </label>
  )
}

function toggle(set: Set<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

type Eval = { accept: boolean; verdict: string; delta: number }

function safeEval(s: GameState, offer: TradeOffer): Eval {
  return evaluateTrade(s, offer)
}

function verdictClass(e: Eval): string {
  if (e.accept) return 'accept'
  const v = e.verdict.toLowerCase()
  if (v.includes('close')) return 'close'
  return 'no'
}

function markerPos(e: Eval): number {
  if (e.accept) return 90
  const v = e.verdict.toLowerCase()
  if (v.includes('insult')) return 8
  if (v.includes('not close')) return 28
  if (v.includes('close')) return 58
  return 40
}

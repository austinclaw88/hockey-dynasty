import { useEffect, useMemo, useState } from 'react'
import type { GameState, Player, DraftPick, PendingOffer } from '../types'
import type { TradeOffer } from '../engine'
import {
  evaluateTrade,
  executeTrade,
  getAiTradeSuggestion,
  getAiTradeSuggestionFor,
  respondToOffer,
  toggleTradeBlock,
} from '../engine'
import { Card, OvrBadge, PosTag, TeamLogo, TeamLink, PlayerLink } from './components'
import { TradeOptionsModal } from './TradeOptions'
import { fmtM, seasonLabel, potArrow } from './format'
import { buildPlayerIndex } from './util'
import { useUI, type TradeIntent } from './uiContext'
import { useMediaQuery } from './useMediaQuery'

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

export function Trades({
  s,
  apply,
  intent,
  onConsumeIntent,
}: {
  s: GameState
  apply: (n: GameState) => void
  intent: TradeIntent | null
  onConsumeIntent: () => void
}) {
  const { pushToast } = useUI()
  const allowed = tradingAllowed(s)
  const others = Object.keys(s.teams)
    .filter((a) => a !== s.userTeam)
    .sort((a, b) => `${s.teams[a].city}`.localeCompare(s.teams[b].city))
  const [partner, setPartner] = useState<string>(others[0] ?? '')
  const [fromPlayers, setFromPlayers] = useState<Set<string>>(new Set())
  const [toPlayers, setToPlayers] = useState<Set<string>>(new Set())
  const [fromPicks, setFromPicks] = useState<Set<string>>(new Set())
  const [toPicks, setToPicks] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState<string | null>(null)
  const [optsFor, setOptsFor] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const userTeam = s.teams[s.userTeam]
  const partnerTeam = partner ? s.teams[partner] : undefined
  const idx = useMemo(() => buildPlayerIndex(s), [s])

  function reset() {
    setFromPlayers(new Set())
    setToPlayers(new Set())
    setFromPicks(new Set())
    setToPicks(new Set())
    setFocus(null)
  }

  /** Load a user-perspective offer (offer.from === userTeam) into the builder. */
  function loadOffer(o: TradeOffer) {
    setPartner(o.to)
    setFromPlayers(new Set(o.fromPlayers))
    setToPlayers(new Set(o.toPlayers))
    setFromPicks(new Set(o.fromPicks.map(pickKey)))
    setToPicks(new Set(o.toPicks.map(pickKey)))
    setFocus(null)
  }

  // Consume a "start a trade" intent coming from a team viewer / offer counter.
  useEffect(() => {
    if (!intent) return
    if (intent.offer) loadOffer(intent.offer)
    else {
      setPartner(intent.partner)
      reset()
    }
    setNotice(null)
    onConsumeIntent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.nonce])

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
  const evalResult = offer && allowed.ok && hasAssets ? evaluateTrade(s, offer) : null

  const focusRef = focus ? idx.get(focus) : undefined
  const focusPlayer = focusRef?.player
  const focusIsUser = focusRef?.team === s.userTeam

  function askAi() {
    if (!partner) return
    const sug = getAiTradeSuggestion(s, partner)
    if (!sug) {
      setNotice({ kind: 'err', text: `${partnerTeam?.name ?? partner} has no obvious trade to offer right now.` })
      return
    }
    setNotice(null)
    loadOffer(sug)
  }

  function buildAround() {
    if (!partner || !focus || !focusPlayer) return
    const sug = getAiTradeSuggestionFor(s, partner, focus)
    if (!sug) {
      pushToast('error', 'No fair deal found.')
      return
    }
    setNotice(null)
    loadOffer(sug)
    pushToast('success', `Built a deal around ${focusPlayer.name}.`)
  }

  function execute() {
    if (!offer) return
    const r = executeTrade(s, offer)
    if (r.ok) {
      apply(r.s)
      reset()
      setNotice({ kind: 'ok', text: 'Trade completed.' })
      pushToast('success', 'Trade completed.')
    } else {
      setNotice({ kind: 'err', text: r.reason ?? 'Trade rejected.' })
      pushToast('error', r.reason ?? 'Trade rejected.')
    }
  }

  return (
    <div className="stack">
      {!allowed.ok && <div className="notice">{allowed.reason}</div>}

      <OffersInbox s={s} apply={apply} onCounter={loadOffer} />

      <Card title="Trade Partner">
        <div className="card-pad">
          <div className="row">
            <TeamLink abbrev={partner} title="View team">
              <TeamLogo team={partnerTeam} size={28} />
            </TeamLink>
            <select value={partner} onChange={(e) => { setPartner(e.target.value); reset(); setNotice(null) }}>
              {others.map((a) => (
                <option key={a} value={a}>
                  {s.teams[a].city} {s.teams[a].name}
                </option>
              ))}
            </select>
            <div className="spacer" />
            <button className="btn btn-ghost" onClick={() => { reset(); setNotice(null) }}>
              Clear
            </button>
          </div>

          <SelectedStrip
            idx={idx}
            userName={userTeam.name}
            partnerName={partnerTeam?.name ?? 'Partner'}
            fromPlayers={fromPlayers}
            toPlayers={toPlayers}
            focus={focus}
            onRemoveFrom={(id) => setFromPlayers((p) => toggle(p, id))}
            onRemoveTo={(id) => setToPlayers((p) => toggle(p, id))}
          />

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" disabled={!allowed.ok} onClick={askAi}>
              Ask AI for an offer
            </button>
            {focusPlayer && (
              <button className="btn btn-primary" disabled={!allowed.ok} onClick={buildAround}>
                Build deal around {focusPlayer.name.split(' ').slice(-1)[0]}
              </button>
            )}
            {focusPlayer && focusIsUser && (
              <button
                className="btn"
                disabled={!allowed.ok}
                onClick={() => setOptsFor(focus)}
                title="Get up to 3 offers from interested teams"
              >
                🔎 Find trade offers
              </button>
            )}
          </div>
          {partnerTeam && (
            <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
              {STRATEGY_HINT[partnerTeam.strategy]} Click a player row to build a deal around them.
            </p>
          )}
        </div>
      </Card>

      <div className="trade-cols">
        <AssetColumn
          title={`${userTeam.name} send`}
          team={userTeam}
          block={new Set(s.tradeBlock)}
          selPlayers={fromPlayers}
          selPicks={fromPicks}
          focus={focus}
          onFocus={setFocus}
          togglePlayer={(id) => setFromPlayers((p) => toggle(p, id))}
          togglePick={(k) => setFromPicks((p) => toggle(p, k))}
        />
        <AssetColumn
          title={`${partnerTeam?.name ?? 'Partner'} send`}
          team={partnerTeam}
          block={new Set()}
          selPlayers={toPlayers}
          selPicks={toPicks}
          focus={focus}
          onFocus={setFocus}
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
                <button className="btn btn-primary btn-lg btn-mblock" disabled={!allowed.ok || !evalResult.accept} onClick={execute}>
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

      <TradeBlockCard s={s} apply={apply} />

      {optsFor && (
        <TradeOptionsModal
          s={s}
          playerId={optsFor}
          onClose={() => setOptsFor(null)}
          onLoad={(o) => {
            loadOffer(o)
            setNotice({ kind: 'ok', text: 'Loaded offer into the trade machine.' })
          }}
        />
      )}
    </div>
  )
}

// ---------------- Selected players strip ----------------

/**
 * Removable name-chips for the players currently on each side of the deal, so
 * "Build deal around X" / evaluate always make obvious WHO is involved. The
 * build-around focus player is highlighted.
 */
function SelectedStrip({
  idx,
  userName,
  partnerName,
  fromPlayers,
  toPlayers,
  focus,
  onRemoveFrom,
  onRemoveTo,
}: {
  idx: ReturnType<typeof buildPlayerIndex>
  userName: string
  partnerName: string
  fromPlayers: Set<string>
  toPlayers: Set<string>
  focus: string | null
  onRemoveFrom: (id: string) => void
  onRemoveTo: (id: string) => void
}) {
  const from = [...fromPlayers]
  const to = [...toPlayers]
  if (from.length === 0 && to.length === 0) {
    return (
      <div className="sel-strip empty">
        <span className="hint">No players selected yet — pick from either side to build the deal.</span>
      </div>
    )
  }
  return (
    <div className="sel-strip">
      <SelSide label={`${userName} send`} kind="give" ids={from} idx={idx} focus={focus} onRemove={onRemoveFrom} />
      <SelSide label={`${partnerName} send`} kind="get" ids={to} idx={idx} focus={focus} onRemove={onRemoveTo} />
    </div>
  )
}

function SelSide({
  label,
  kind,
  ids,
  idx,
  focus,
  onRemove,
}: {
  label: string
  kind: 'give' | 'get'
  ids: string[]
  idx: ReturnType<typeof buildPlayerIndex>
  focus: string | null
  onRemove: (id: string) => void
}) {
  return (
    <div className="sel-side">
      <div className={`offer-label ${kind}`}>{label}</div>
      {ids.length === 0 ? (
        <span className="hint">—</span>
      ) : (
        <div className="chip-wrap">
          {ids.map((id) => {
            const p = idx.get(id)?.player
            return (
              <span key={id} className={`sel-chip ${focus === id ? 'focus' : ''}`}>
                {p && <PosTag pos={p.pos} />}
                <span className="a-name">{p?.name ?? id}</span>
                {p && <OvrBadge overall={p.overall} />}
                <button className="block-remove" title="Remove from deal" onClick={() => onRemove(id)}>
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------- Offers inbox ----------------

function OffersInbox({ s, apply, onCounter }: { s: GameState; apply: (n: GameState) => void; onCounter: (o: TradeOffer) => void }) {
  const offers = s.pendingOffers
  return (
    <Card title={offers.length > 0 ? `Trade Offers · ${offers.length}` : 'Trade Offers'}>
      <div className="card-pad stack">
        {offers.length === 0 ? (
          <div className="hint">No offers yet. Put players on the trade block to attract calls.</div>
        ) : (
          <>
            <div className="hint">Rival GMs have proposed these deals. Accept, decline, or take them into the machine to counter.</div>
            {offers.map((o) => (
              <OfferRow key={o.id} s={s} apply={apply} offer={o} onCounter={onCounter} />
            ))}
          </>
        )}
      </div>
    </Card>
  )
}

function OfferRow({ s, apply, offer, onCounter }: { s: GameState; apply: (n: GameState) => void; offer: PendingOffer; onCounter: (o: TradeOffer) => void }) {
  const { pushToast } = useUI()
  const [confirming, setConfirming] = useState(false)
  const idx = useMemo(() => buildPlayerIndex(s), [s])
  const o = offer.offer // from === user, to === AI partner
  const partnerTeam = s.teams[o.to]

  function respond(accept: boolean) {
    const r = respondToOffer(s, offer.id, accept)
    if (r.ok) {
      apply(r.s)
      pushToast('success', accept ? 'Trade completed.' : 'Offer declined.')
    } else {
      pushToast('error', r.reason ?? 'Could not process that offer.')
    }
    setConfirming(false)
  }

  return (
    <div className="offer-card">
      <div className="offer-head">
        <TeamLink abbrev={o.to} title="View team">
          <TeamLogo team={partnerTeam} size={24} />
          <strong>{partnerTeam?.city} {partnerTeam?.name}</strong>
        </TeamLink>
        <span className="hint">proposes:</span>
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
        {confirming ? (
          <>
            <span className="hint">Accept this trade?</span>
            <button className="btn btn-primary" onClick={() => respond(true)}>Confirm</button>
            <button className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button className="btn btn-good" onClick={() => setConfirming(true)}>Accept</button>
            <button className="btn btn-danger" onClick={() => respond(false)}>Decline</button>
            <button className="btn" onClick={() => onCounter(o)}>Counter in Trade Machine</button>
          </>
        )}
      </div>
    </div>
  )
}

function AssetList({ players, picks, idx }: { players: string[]; picks: DraftPick[]; idx: ReturnType<typeof buildPlayerIndex> }) {
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
          <span className="tag">{seasonLabel(p.year)} R{p.round}</span>
          {p.originalTeam !== p.owner && <span className="strength">via {p.originalTeam}</span>}
        </div>
      ))}
    </div>
  )
}

// ---------------- Trade block ----------------

function TradeBlockCard({ s, apply }: { s: GameState; apply: (n: GameState) => void }) {
  const { pushToast } = useUI()
  const team = s.teams[s.userTeam]
  const blocked = s.tradeBlock
    .map((id) => team.roster.find((p) => p.id === id) ?? team.prospects.find((p) => p.id === id))
    .filter((p): p is Player => Boolean(p))

  return (
    <Card title={`Trade Block · ${blocked.length}`}>
      <div className="card-pad stack" style={{ gap: 10 }}>
        <div className="hint">Players you shop here attract AI trade offers. Remove anyone you no longer want to move.</div>
        {blocked.length === 0 ? (
          <div className="news-empty">No players on the block. Add some from the Roster screen.</div>
        ) : (
          <div className="chip-wrap">
            {blocked.map((p) => (
              <span key={p.id} className="block-chip">
                <PosTag pos={p.pos} />
                <span className="a-name">{p.name}</span>
                <OvrBadge overall={p.overall} />
                <button
                  className="block-remove"
                  title="Remove from block"
                  onClick={() => {
                    apply(toggleTradeBlock(s, p.id))
                    pushToast('success', `Removed ${p.name} from the trade block.`)
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

// ---------------- Asset columns ----------------

function AssetColumn({
  title,
  team,
  block,
  selPlayers,
  selPicks,
  focus,
  onFocus,
  togglePlayer,
  togglePick,
}: {
  title: string
  team: GameState['teams'][string] | undefined
  block: Set<string>
  selPlayers: Set<string>
  selPicks: Set<string>
  focus: string | null
  onFocus: (id: string) => void
  togglePlayer: (id: string) => void
  togglePick: (k: string) => void
}) {
  const isMobile = useMediaQuery('(max-width: 720px)')
  const [collapsed, setCollapsed] = useState(false)
  if (!team) return <Card title={title}><div className="news-empty">Pick a partner.</div></Card>
  const roster = [...team.roster].sort((a, b) => b.overall - a.overall)
  const prospects = [...team.prospects].sort((a, b) => b.overall - a.overall)
  const picks = [...team.picks].sort((a, b) => a.year - b.year || a.round - b.round)
  const selCount = selPlayers.size + selPicks.size
  const showBody = !isMobile || !collapsed
  return (
    <Card
      title={title}
      right={
        isMobile ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            aria-expanded={showBody}
            onClick={() => setCollapsed((c) => !c)}
          >
            {selCount > 0 ? `${selCount} selected · ` : ''}
            {collapsed ? 'Show' : 'Hide'}
          </button>
        ) : undefined
      }
    >
      {showBody && (
      <div style={{ maxHeight: isMobile ? 'none' : 460, overflowY: 'auto' }}>
        <div className="group-label">Roster</div>
        {roster.map((p) => (
          <PlayerAsset
            key={p.id}
            p={p}
            teamAbbrev={team.abbrev}
            checked={selPlayers.has(p.id)}
            focused={focus === p.id}
            onBlock={block.has(p.id)}
            onToggle={() => togglePlayer(p.id)}
            onFocus={() => onFocus(p.id)}
          />
        ))}
        {prospects.length > 0 && (
          <>
            <div className="group-label">Prospects</div>
            {prospects.map((p) => (
              <PlayerAsset
                key={p.id}
                p={p}
                teamAbbrev={team.abbrev}
                isProspect
                checked={selPlayers.has(p.id)}
                focused={focus === p.id}
                onBlock={block.has(p.id)}
                onToggle={() => togglePlayer(p.id)}
                onFocus={() => onFocus(p.id)}
              />
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
      )}
    </Card>
  )
}

function PlayerAsset({
  p,
  teamAbbrev,
  isProspect,
  checked,
  focused,
  onBlock,
  onToggle,
  onFocus,
}: {
  p: Player
  teamAbbrev: string
  isProspect?: boolean
  checked: boolean
  focused: boolean
  onBlock: boolean
  onToggle: () => void
  onFocus: () => void
}) {
  const pot = potArrow(p.overall, p.potential)
  // Row click selects the asset for the trade and focuses it (for build-around);
  // the name is an explicit link that opens the player card instead.
  function selectRow() {
    onToggle()
    onFocus()
  }
  return (
    <div
      className={`asset ${checked ? 'sel' : ''} ${focused ? 'focused' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={checked}
      onClick={selectRow}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          selectRow()
        }
      }}
    >
      <input type="checkbox" checked={checked} readOnly tabIndex={-1} aria-label={`Include ${p.name}`} />
      <PosTag pos={p.pos} />
      <PlayerLink id={p.id} player={p} team={teamAbbrev} className="a-name asset-name-btn" title="View player card">
        {p.name}
        {onBlock && <span className="shop-badge">SHOP</span>}
        {p.contract?.ntc && <span className="ntc-tag">NTC</span>}
      </PlayerLink>
      {isProspect ? (
        <span className="strength">
          POT {p.potential}
          <span className={pot.cls}> {pot.symbol}</span>
        </span>
      ) : (
        <span className="strength">{p.contract ? fmtM(p.contract.capHit) : '—'}</span>
      )}
      <OvrBadge overall={p.overall} />
    </div>
  )
}

function toggle(set: Set<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

type Eval = { accept: boolean; verdict: string; delta: number }

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

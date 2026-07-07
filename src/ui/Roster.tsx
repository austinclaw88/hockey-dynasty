import { useMemo, useState } from 'react'
import type { GameState, Player, LineAssignments } from '../types'
import { callUp, sendDown, getCapUsage, getStandings, toggleTradeBlock, setUserLines, effectiveLines } from '../engine'
import { Card, OvrBadge, PosTag, CapBar, ExpiryTag, Flag, ShopBadge, TeamLogo } from './components'
import { PlayerModal } from './PlayerModal'
import { TradeOptionsModal } from './TradeOptions'
import { ExtensionModal } from './ExtensionModal'
import { fmtM, fmtRecord, potArrow, posGroup } from './format'
import { isHealthy, buildPlayerIndex, teamOverall, capZone } from './util'
import { useUI } from './uiContext'
import { PosFilter, matchesPos, SearchInput } from './filters'

type SortKey = 'name' | 'pos' | 'age' | 'overall' | 'potential' | 'capHit' | 'yearsLeft' | 'points' | 'goals' | 'assists'

const canSendDown = (p: Player) => p.age <= 25 && p.overall <= 78

const STRATEGY_LABEL: Record<GameState['teams'][string]['strategy'], string> = {
  contend: 'Contender',
  retool: 'Retooling',
  rebuild: 'Rebuilding',
}

/** Team identity band that heads the roster page (record · cap · strategy). */
function RosterHeader({ s }: { s: GameState }) {
  const team = s.teams[s.userTeam]
  const cap = getCapUsage(s, s.userTeam)
  const row = getStandings(s).league.find((r) => r.team === s.userTeam)
  const space = Math.round((cap.cap - cap.used) * 100) / 100
  return (
    <div className="roster-band">
      <div className="roster-band-id">
        <TeamLogo team={team} size={44} fallback={<span className="hero-crest">{team.abbrev}</span>} />
        <div>
          <div className="roster-band-eyebrow">
            Roster
            <span className={`strat-chip strat-${team.strategy}`}>{STRATEGY_LABEL[team.strategy]}</span>
          </div>
          <div className="roster-band-name">
            {team.city} {team.name}
          </div>
        </div>
      </div>
      <div className="roster-band-stats">
        {row && (
          <div className="rb-stat">
            <div className="rb-k">Record</div>
            <div className="rb-v">{fmtRecord(row.w, row.l, row.otl)}</div>
          </div>
        )}
        <div className="rb-stat">
          <div className="rb-k">Team OVR</div>
          <div className="rb-v">{teamOverall(team.roster).toFixed(1)}</div>
        </div>
        <div className={`rb-stat rb-cap ${capZone(cap.used, cap.cap)}`}>
          <div className="rb-k">Cap Space</div>
          <div className="rb-v">
            {space >= 0 ? fmtM(space) : `-${fmtM(Math.abs(space))}`}
          </div>
        </div>
      </div>
    </div>
  )
}

export function Roster({ s, apply }: { s: GameState; apply: (n: GameState) => void }) {
  const team = s.teams[s.userTeam]
  const { pushToast, startTrade } = useUI()
  const [sel, setSel] = useState<string | null>(null)
  const [optsFor, setOptsFor] = useState<string | null>(null)
  const [extendFor, setExtendFor] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'overall', dir: -1 })
  const [posF, setPosF] = useState<'ALL' | 'F' | 'D' | 'G'>('ALL')
  const [query, setQuery] = useState('')
  const cap = getCapUsage(s, s.userTeam)
  const block = new Set(s.tradeBlock)

  const filtered = team.roster.filter(
    (p) => matchesPos(p, posF) && p.name.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const sorted = [...filtered].sort((a, b) => cmp(a, b, sort, s) * sort.dir)
  const selPlayer =
    sel != null ? team.roster.find((p) => p.id === sel) ?? team.prospects.find((p) => p.id === sel) : undefined
  const selIsProspect = selPlayer != null && team.prospects.some((p) => p.id === selPlayer.id)

  function doCallUp(id: string, name: string) {
    const r = callUp(s, id)
    if (r.ok) {
      apply(r.s)
      setSel(null)
      setNotice(null)
      pushToast('success', `Called up ${name} to the NHL.`)
    } else {
      setNotice(r.reason ?? 'Cannot call up this player.')
      pushToast('error', r.reason ?? 'Cannot call up this player.')
    }
  }
  function doSendDown(id: string, name: string) {
    const r = sendDown(s, id)
    if (r.ok) {
      apply(r.s)
      setSel(null)
      setNotice(null)
      pushToast('success', `Sent ${name} down to juniors.`)
    } else {
      setNotice(r.reason ?? 'Cannot send down this player.')
      pushToast('error', r.reason ?? 'Cannot send down this player.')
    }
  }
  function doToggleBlock(p: Player) {
    const onBlock = block.has(p.id)
    apply(toggleTradeBlock(s, p.id))
    pushToast('success', onBlock ? `Removed ${p.name} from the trade block.` : 'On the block — teams will call.')
  }

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
    <div className="stack">
      <RosterHeader s={s} />
      <div className="roster-body">
      <Card
        title={`Skaters & Goalies · ${sorted.length}${sorted.length !== team.roster.length ? ` / ${team.roster.length}` : ''}`}
        right={
          <div className="row" style={{ gap: 8 }}>
            <PosFilter value={posF} onChange={setPosF} />
            <SearchInput value={query} onChange={setQuery} placeholder="Search players" />
          </div>
        }
      >
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
                  {th('yearsLeft', 'Yrs', true, 'm-hide')}
                  <th className="m-hide">Exp</th>
                  {th('goals', 'G', true)}
                  {th('assists', 'A', true)}
                  {th('points', 'P', true)}
                  <th title="Trade block">Shop</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={12} className="muted" style={{ textAlign: 'center', padding: 20 }}>
                      No players match those filters.
                    </td>
                  </tr>
                )}
                {sorted.map((p) => {
                  const pot = potArrow(p.overall, p.potential)
                  const line = s.stats[p.id]
                  const onBlock = block.has(p.id)
                  return (
                    <tr key={p.id} className="clickable" onClick={() => setSel(p.id)}>
                      <td className="name-cell">
                        {p.name}
                        {onBlock && <ShopBadge />}
                        {p.contract?.yearsLeft === 1 && (
                          <span className="ntc-tag" style={{ marginLeft: 6, color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 45%, transparent)' }} title="Contract expires after this season">
                            EXP
                          </span>
                        )}
                        {!isHealthy(p) && <span className="ntc-tag" style={{ marginLeft: 6 }}>INJ</span>}
                        {p.contract?.ntc && <span className="ntc-tag">NTC</span>}{' '}
                        <Flag nat={p.nationality} />
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
                      <td className="num m-hide">{p.contract?.yearsLeft ?? '—'}</td>
                      <td className="m-hide">{p.contract ? <ExpiryTag expiry={p.contract.expiry} /> : '—'}</td>
                      <td className="num">{p.pos === 'G' ? '—' : line?.goals ?? 0}</td>
                      <td className="num">{p.pos === 'G' ? '—' : line?.assists ?? 0}</td>
                      <td className="num">{p.pos === 'G' ? '—' : line?.points ?? 0}</td>
                      <td>
                        <button
                          className={`btn btn-sm shop-btn ${onBlock ? 'on' : ''}`}
                          title={onBlock ? 'On the trade block — click to remove' : 'Put on the trade block'}
                          aria-pressed={onBlock}
                          onClick={(e) => {
                            e.stopPropagation()
                            doToggleBlock(p)
                          }}
                        >
                          🏷 {onBlock ? 'Unshop' : 'Shop'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="roster-side stack">
          <LinesEditor s={s} apply={apply} pushToast={pushToast} />
          <Card title="Salary Cap">
            <div className="card-pad">
              <CapBar
                used={cap.used}
                cap={cap.cap}
                capYear={cap.capYear}
                note={s.phase === 'offseason' ? 'Signings count against next season’s cap.' : undefined}
              />
            </div>
          </Card>
        </div>
      </div>

      <Card title={`Prospects · ${team.prospects.length}`}>
        {team.prospects.length === 0 ? (
          <div className="news-empty">No prospects in the system.</div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Pos</th>
                  <th className="m-hide">League</th>
                  <th className="num m-hide">Age</th>
                  <th className="num">OVR</th>
                  <th className="num">POT</th>
                  <th className="num m-hide">Cap</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...team.prospects]
                  .sort((a, b) => posGroup(a.pos) - posGroup(b.pos) || b.overall - a.overall)
                  .map((p) => {
                    const pot = potArrow(p.overall, p.potential)
                    const onBlock = block.has(p.id)
                    return (
                      <tr key={p.id} className="clickable" onClick={() => setSel(p.id)}>
                        <td className="name-cell">
                          {p.name}
                          {onBlock && <ShopBadge />} <Flag nat={p.nationality} />
                        </td>
                        <td>
                          <PosTag pos={p.pos} />
                        </td>
                        <td className="dim m-hide">{p.devLeague ?? '—'}</td>
                        <td className="num m-hide">{p.age}</td>
                        <td className="num">
                          <OvrBadge overall={p.overall} />
                        </td>
                        <td className="num">
                          {p.potential}
                          <span className={pot.cls}> {pot.symbol}</span>
                        </td>
                        <td className="num m-hide">{p.contract ? fmtM(p.contract.capHit) : '—'}</td>
                        <td>
                          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                            <button
                              className={`btn btn-sm shop-btn ${onBlock ? 'on' : ''}`}
                              title={onBlock ? 'On the trade block — click to remove' : 'Put on the trade block'}
                              aria-pressed={onBlock}
                              onClick={(e) => {
                                e.stopPropagation()
                                doToggleBlock(p)
                              }}
                            >
                              🏷 {onBlock ? 'Unshop' : 'Shop'}
                            </button>
                            <button
                              className="btn btn-sm btn-good"
                              onClick={(e) => {
                                e.stopPropagation()
                                doCallUp(p.id, p.name)
                              }}
                            >
                              Call Up
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {notice && <div className="notice err">{notice}</div>}

      {selPlayer && (
        <PlayerModal
          s={s}
          player={selPlayer}
          team={s.userTeam}
          onClose={() => {
            setSel(null)
            setNotice(null)
          }}
          actions={
            <div className="modal-actions">
              <div className="row">
                {selIsProspect ? (
                  <button className="btn btn-good" onClick={() => doCallUp(selPlayer.id, selPlayer.name)}>
                    Call Up to NHL
                  </button>
                ) : canSendDown(selPlayer) ? (
                  <button className="btn btn-danger" onClick={() => doSendDown(selPlayer.id, selPlayer.name)}>
                    Send Down to Juniors
                  </button>
                ) : (
                  <span className="hint">Roster player · not waiver/send-down eligible.</span>
                )}
              </div>
              {!selIsProspect && s.phase === 'regular' && selPlayer.contract?.yearsLeft === 1 && (
                <button className="btn btn-block btn-good" onClick={() => setExtendFor(selPlayer.id)}>
                  ✍ Offer Extension
                </button>
              )}
              <button
                className={`btn btn-block ${block.has(selPlayer.id) ? 'btn-good' : 'btn-primary'}`}
                onClick={() => doToggleBlock(selPlayer)}
              >
                {block.has(selPlayer.id) ? '🏷 Remove from trade block' : '🏷 Put on trade block'}
              </button>
              <button className="btn btn-block" onClick={() => setOptsFor(selPlayer.id)}>
                🔎 Find trade offers
              </button>
            </div>
          }
        />
      )}

      {optsFor && (
        <TradeOptionsModal
          s={s}
          playerId={optsFor}
          onClose={() => setOptsFor(null)}
          onLoad={(offer) => startTrade(offer.to, offer)}
        />
      )}

      {extendFor && (() => {
        const p = team.roster.find((x) => x.id === extendFor)
        return p ? <ExtensionModal s={s} player={p} apply={apply} onClose={() => setExtendFor(null)} /> : null
      })()}
    </div>
  )
}

type LineSection = 'F' | 'D' | 'G'
interface SlotRef {
  sec: LineSection
  i: number
  j: number
}

const FWD_POS = ['LW', 'C', 'RW']
const DEF_POS = ['LD', 'RD']
const GOALIE_POS = ['S', 'B']

const lastName = (name: string) => name.split(' ').slice(-1)[0]
const sameSlot = (a: SlotRef, b: SlotRef) => a.sec === b.sec && a.i === b.i && a.j === b.j

function slotLabel(slot: SlotRef): string {
  if (slot.sec === 'F') return FWD_POS[slot.j] ?? ''
  if (slot.sec === 'D') return DEF_POS[slot.j] ?? ''
  return GOALIE_POS[slot.j] ?? 'G'
}

/** Position group a slot accepts, for the eligible-players list. */
function slotGroup(sec: LineSection): Player['pos'][] {
  if (sec === 'F') return ['C', 'LW', 'RW']
  if (sec === 'D') return ['D']
  return ['G']
}

/**
 * Editable lines panel. Renders the ENGINE's fully-resolved lineup
 * (effectiveLines) so injuries/auto-fill are already reflected, and writes any
 * edit straight back with setUserLines. Slots the user hasn't pinned show an
 * AUTO badge; pinned picks render as solid manual chips.
 */
function LinesEditor({
  s,
  apply,
  pushToast,
}: {
  s: GameState
  apply: (n: GameState) => void
  pushToast: (kind: 'success' | 'error', text: string) => void
}) {
  const team = s.teams[s.userTeam]
  const idx = useMemo(() => buildPlayerIndex(s), [s])
  const eff = effectiveLines(s, s.userTeam)
  const ul = s.userLines
  const custom = !!ul
  const [sel, setSel] = useState<SlotRef | null>(null)

  const effAt = (slot: SlotRef): string => {
    if (slot.sec === 'F') return eff.forwards[slot.i]?.[slot.j] ?? ''
    if (slot.sec === 'D') return eff.defense[slot.i]?.[slot.j] ?? ''
    return eff.goalies[slot.j] ?? ''
  }
  const isOverride = (slot: SlotRef): boolean => {
    if (!ul) return false
    if (slot.sec === 'F') return !!ul.forwards?.[slot.i]?.[slot.j]
    if (slot.sec === 'D') return !!ul.defense?.[slot.i]?.[slot.j]
    return !!ul.goalies?.[slot.j]
  }

  const baseGrid = (): LineAssignments => ({
    forwards: [0, 1, 2, 3].map((i) => [0, 1, 2].map((j) => ul?.forwards?.[i]?.[j] ?? '')),
    defense: [0, 1, 2].map((i) => [0, 1].map((j) => ul?.defense?.[i]?.[j] ?? '')),
    goalies: [ul?.goalies?.[0] ?? '', ul?.goalies?.[1] ?? ''],
  })
  const writeSlot = (grid: LineAssignments, slot: SlotRef, id: string) => {
    if (slot.sec === 'F') grid.forwards[slot.i][slot.j] = id
    else if (slot.sec === 'D') grid.defense[slot.i][slot.j] = id
    else grid.goalies[slot.j] = id
  }
  const clearId = (grid: LineAssignments, id: string) => {
    grid.forwards.forEach((ln) => ln.forEach((v, j) => v === id && (ln[j] = '')))
    grid.defense.forEach((ln) => ln.forEach((v, j) => v === id && (ln[j] = '')))
    grid.goalies.forEach((v, j) => v === id && (grid.goalies[j] = ''))
  }

  function onSlotTap(slot: SlotRef) {
    if (!sel) {
      setSel(slot)
      return
    }
    if (sameSlot(sel, slot)) {
      setSel(null)
      return
    }
    if (sel.sec !== slot.sec) {
      // Can't swap across forward/defense/goalie groups — reselect instead.
      setSel(slot)
      return
    }
    const grid = baseGrid()
    const a = effAt(sel)
    const b = effAt(slot)
    writeSlot(grid, sel, b)
    writeSlot(grid, slot, a)
    apply(setUserLines(s, grid))
    setSel(null)
  }

  function onAssign(p: Player) {
    if (!sel || !isHealthy(p)) return
    const grid = baseGrid()
    clearId(grid, p.id)
    writeSlot(grid, sel, p.id)
    apply(setUserLines(s, grid))
    setSel(null)
  }

  function resetToAuto() {
    apply(setUserLines(s, null))
    setSel(null)
    pushToast('success', 'Lines reset to auto.')
  }

  const eligible = sel
    ? team.roster
        .filter((p) => slotGroup(sel.sec).includes(p.pos))
        .sort((a, b) => Number(!isHealthy(a)) - Number(!isHealthy(b)) || b.overall - a.overall)
    : []

  const renderSlot = (slot: SlotRef) => {
    const id = effAt(slot)
    const p = id ? idx.get(id)?.player : undefined
    const override = isOverride(slot)
    const selected = sel != null && sameSlot(sel, slot)
    const injured = p != null && !isHealthy(p)
    const label = slotLabel(slot)
    const offPos = p != null && slot.sec === 'F' && p.pos !== label
    return (
      <span key={`${slot.sec}${slot.i}-${slot.j}`} className="line-slot">
        <span className="slot-pos">{label}</span>
        <button
          type="button"
          className={`lineup-chip ${override ? 'manual' : 'auto'}${selected ? ' sel' : ''}${p ? '' : ' empty'}`}
          onClick={() => onSlotTap(slot)}
          title={
            p
              ? `${p.name} · ${p.pos} · ${p.overall} OVR${override ? ' · pinned' : ' · auto'}`
              : 'Empty slot — tap to fill'
          }
        >
          {p ? (
            <>
              <span className="chip-name">{lastName(p.name)}</span>
              <span className="chip-ovr">{p.overall}</span>
              {offPos && <span className="slot-off">{p.pos}</span>}
              {injured && <span className="chip-inj" title="Injured">✚</span>}
              {!override && <span className="chip-flag">AUTO</span>}
            </>
          ) : (
            <span className="chip-none">—</span>
          )}
        </button>
      </span>
    )
  }

  return (
    <Card
      title="Lines"
      right={
        <button className="btn btn-sm btn-ghost" disabled={!custom} onClick={resetToAuto}>
          Reset to Auto
        </button>
      }
    >
      <div className="card-pad lines-editor">
        <div className="lines-status">
          {custom ? 'Custom lines — auto-saved' : 'Auto lines'}
          {sel && <span className="lines-pick"> · pick a player or slot for {slotLabel(sel)}</span>}
        </div>

        {[0, 1, 2, 3].map((i) => (
          <div className="line-group" key={`f${i}`}>
            <span className="line-label">L{i + 1}</span>
            {[0, 1, 2].map((j) => renderSlot({ sec: 'F', i, j }))}
          </div>
        ))}
        {[0, 1, 2].map((i) => (
          <div className="line-group" key={`d${i}`}>
            <span className="line-label">P{i + 1}</span>
            {[0, 1].map((j) => renderSlot({ sec: 'D', i, j }))}
          </div>
        ))}
        <div className="line-group">
          <span className="line-label">G</span>
          {[0, 1].map((j) => renderSlot({ sec: 'G', i: 0, j }))}
        </div>

        <div className="lines-hint">Top-line minutes boost scoring — and help young players develop faster.</div>

        {sel && (
          <div className="eligible-panel">
            <div className="eligible-head">
              <span>
                Tap a player for <strong>{slotLabel(sel)}</strong>
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => setSel(null)}>
                Cancel
              </button>
            </div>
            <div className="eligible-list">
              {eligible.map((p) => {
                const inj = !isHealthy(p)
                const dressed = effAt(sel) === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`eligible-chip${inj ? ' inj' : ''}${dressed ? ' here' : ''}`}
                    disabled={inj}
                    onClick={() => onAssign(p)}
                    title={`${p.name} · ${p.pos} · ${p.overall} OVR`}
                  >
                    <PosTag pos={p.pos} />
                    <span className="chip-name">{lastName(p.name)}</span>
                    <span className="chip-ovr">{p.overall}</span>
                    {inj && <span className="chip-inj">✚</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function cmp(a: Player, b: Player, sort: { key: SortKey }, s: GameState): number {
  switch (sort.key) {
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
    case 'yearsLeft':
      return (a.contract?.yearsLeft ?? 0) - (b.contract?.yearsLeft ?? 0)
    case 'points':
      return (s.stats[a.id]?.points ?? 0) - (s.stats[b.id]?.points ?? 0)
    case 'goals':
      return (s.stats[a.id]?.goals ?? 0) - (s.stats[b.id]?.goals ?? 0)
    case 'assists':
      return (s.stats[a.id]?.assists ?? 0) - (s.stats[b.id]?.assists ?? 0)
    default:
      return 0
  }
}

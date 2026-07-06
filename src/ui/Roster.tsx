import { useState } from 'react'
import type { GameState, Player } from '../types'
import { callUp, sendDown, getCapUsage, toggleTradeBlock } from '../engine'
import { Card, OvrBadge, PosTag, CapBar, ExpiryTag, Flag, ShopBadge } from './components'
import { PlayerModal } from './PlayerModal'
import { fmtM, potArrow, posGroup } from './format'
import { autoLines, isHealthy } from './util'
import type { ForwardSlot } from './util'
import { useUI } from './uiContext'
import { PosFilter, matchesPos, SearchInput } from './filters'

type SortKey = 'name' | 'pos' | 'age' | 'overall' | 'potential' | 'capHit' | 'yearsLeft' | 'points' | 'goals'

const canSendDown = (p: Player) => p.age <= 25 && p.overall <= 78

export function Roster({ s, apply }: { s: GameState; apply: (n: GameState) => void }) {
  const team = s.teams[s.userTeam]
  const { pushToast } = useUI()
  const [sel, setSel] = useState<string | null>(null)
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
    pushToast('success', onBlock ? `Removed ${p.name} from the trade block.` : `${p.name} is now on the trade block.`)
  }

  function th(key: SortKey, label: string, num = false) {
    const active = sort.key === key
    return (
      <th
        className={`sortable ${num ? 'num' : ''}`}
        onClick={() => setSort((p) => ({ key, dir: p.key === key && p.dir === -1 ? 1 : -1 }))}
      >
        {label}
        {active ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
      </th>
    )
  }

  return (
    <div className="stack">
      <div className="grid dash-grid">
        <Card
          title={`Roster · ${sorted.length}${sorted.length !== team.roster.length ? ` / ${team.roster.length}` : ''}`}
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
                  {th('age', 'Age', true)}
                  {th('overall', 'OVR', true)}
                  {th('potential', 'POT', true)}
                  {th('capHit', 'Cap', true)}
                  {th('yearsLeft', 'Yrs', true)}
                  <th>Exp</th>
                  {th('goals', 'G', true)}
                  {th('points', 'PTS', true)}
                  <th title="Trade block">Shop</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={11} className="muted" style={{ textAlign: 'center', padding: 20 }}>
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
                        {!isHealthy(p) && <span className="ntc-tag" style={{ marginLeft: 6 }}>INJ</span>}
                        {p.contract?.ntc && <span className="ntc-tag">NTC</span>}{' '}
                        <Flag nat={p.nationality} />
                      </td>
                      <td>
                        <PosTag pos={p.pos} />
                      </td>
                      <td className="num">{p.age}</td>
                      <td className="num">
                        <OvrBadge overall={p.overall} />
                      </td>
                      <td className="num">
                        {p.potential}
                        <span className={pot.cls}> {pot.symbol}</span>
                      </td>
                      <td className="num">{p.contract ? fmtM(p.contract.capHit) : '—'}</td>
                      <td className="num">{p.contract?.yearsLeft ?? '—'}</td>
                      <td>{p.contract ? <ExpiryTag expiry={p.contract.expiry} /> : '—'}</td>
                      <td className="num">{line?.goals ?? 0}</td>
                      <td className="num">{p.pos === 'G' ? '—' : line?.points ?? 0}</td>
                      <td>
                        <button
                          className={`shop-toggle ${onBlock ? 'on' : ''}`}
                          title={onBlock ? 'On the trade block — click to remove' : 'Put on the trade block'}
                          aria-pressed={onBlock}
                          onClick={(e) => {
                            e.stopPropagation()
                            doToggleBlock(p)
                          }}
                        >
                          🏷
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="stack">
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
          <LinesCard team={team} onPick={setSel} s={s} />
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
                  <th>League</th>
                  <th className="num">Age</th>
                  <th className="num">OVR</th>
                  <th className="num">POT</th>
                  <th className="num">Cap</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...team.prospects]
                  .sort((a, b) => posGroup(a.pos) - posGroup(b.pos) || b.overall - a.overall)
                  .map((p) => {
                    const pot = potArrow(p.overall, p.potential)
                    return (
                      <tr key={p.id} className="clickable" onClick={() => setSel(p.id)}>
                        <td className="name-cell">
                          {p.name} <Flag nat={p.nationality} />
                        </td>
                        <td>
                          <PosTag pos={p.pos} />
                        </td>
                        <td className="dim">{p.devLeague ?? '—'}</td>
                        <td className="num">{p.age}</td>
                        <td className="num">
                          <OvrBadge overall={p.overall} />
                        </td>
                        <td className="num">
                          {p.potential}
                          <span className={pot.cls}> {pot.symbol}</span>
                        </td>
                        <td className="num">{p.contract ? fmtM(p.contract.capHit) : '—'}</td>
                        <td>
                          <button
                            className="btn btn-sm btn-good"
                            onClick={(e) => {
                              e.stopPropagation()
                              doCallUp(p.id, p.name)
                            }}
                          >
                            Call Up
                          </button>
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
            <>
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
              {!selIsProspect && (
                <button
                  className={`btn ${block.has(selPlayer.id) ? 'btn-good' : ''}`}
                  onClick={() => doToggleBlock(selPlayer)}
                >
                  {block.has(selPlayer.id) ? '🏷 Remove from Block' : '🏷 Put on Trade Block'}
                </button>
              )}
            </>
          }
        />
      )}
    </div>
  )
}

function LinesCard({ team, onPick, s }: { team: GameState['teams'][string]; onPick: (id: string) => void; s: GameState }) {
  const lines = autoLines(team.roster)
  const chip = (p: Player) => (
    <button
      key={p.id}
      className="tag"
      style={{ cursor: 'pointer' }}
      onClick={() => onPick(p.id)}
      title={`${p.name} · ${p.overall} OVR`}
    >
      {p.name.split(' ').slice(-1)[0]} {p.overall}
    </button>
  )
  const slotChip = (fs: ForwardSlot, key: string) => {
    const p = fs.player
    if (!p) {
      return (
        <span key={key} className="line-slot">
          <span className="slot-pos">{fs.slot}</span>
          <span className="tag slot-empty">—</span>
        </span>
      )
    }
    const offPos = p.pos !== fs.slot
    return (
      <span key={p.id} className="line-slot">
        <span className="slot-pos">{fs.slot}</span>
        <button
          className="tag"
          style={{ cursor: 'pointer' }}
          onClick={() => onPick(p.id)}
          title={`${p.name} · ${p.pos} · ${p.overall} OVR${offPos ? ` (playing ${fs.slot})` : ''}`}
        >
          {p.name.split(' ').slice(-1)[0]} {p.overall}
          {offPos && <span className="slot-off"> {p.pos}</span>}
        </button>
      </span>
    )
  }
  return (
    <Card title="Auto Lines">
      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {lines.forwards.map((ln, i) => (
          <LineRow key={`f${i}`} label={`L${i + 1}`}>
            {ln.map((fs, j) => slotChip(fs, `f${i}-${j}`))}
          </LineRow>
        ))}
        {lines.defense.map((pr, i) => (
          <LineRow key={`d${i}`} label={`P${i + 1}`}>
            {pr.map(chip)}
          </LineRow>
        ))}
        <LineRow label="G">{lines.goalies.map(chip)}</LineRow>
        {lines.scratches.length > 0 && (
          <LineRow label="Scr">{lines.scratches.map(chip)}</LineRow>
        )}
      </div>
    </Card>
  )
}

function LineRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <span className="k" style={{ minWidth: 30, color: 'var(--text-faint)', fontWeight: 700, fontSize: 11 }}>
        {label}
      </span>
      {children}
    </div>
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
    default:
      return 0
  }
}

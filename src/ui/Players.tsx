import { useEffect, useMemo, useState } from 'react'
import type { GameState, Player, FreeAgent } from '../types'
import { signFreeAgent } from '../engine'
import { Card, OvrBadge, PosTag, TeamLogo, PlayerLink } from './components'
import { fmtM, potArrow, posGroup } from './format'
import { buildPlayerIndex } from './util'
import { PosFilter, matchesPos, SearchInput } from './filters'
import type { PosFilterValue } from './filters'
import { useUI } from './uiContext'
import { OfferModal } from './signing'

type Status = 'NHL' | 'prospect' | 'FA'
type StatusFilter = 'ALL' | Status

interface Row {
  player: Player
  team?: string
  status: Status
}

type SortKey = 'name' | 'team' | 'pos' | 'age' | 'overall' | 'potential' | 'capHit' | 'goals' | 'assists' | 'points'

const PAGE = 100

const STATUS_OPTS: StatusFilter[] = ['ALL', 'NHL', 'prospect', 'FA']
const STATUS_LABEL: Record<StatusFilter, string> = { ALL: 'All', NHL: 'NHL', prospect: 'Prospects', FA: 'Free Agents' }

/**
 * League-wide player directory: every rostered player, prospect and free agent
 * in one searchable, sortable table. Rows open the shared player card.
 * Paginated with a "show more" control so ~1300 rows stay responsive.
 */
export function Players({ s, apply, faIntent }: { s: GameState; apply?: (n: GameState) => void; faIntent?: number }) {
  const { pushToast } = useUI()
  const [query, setQuery] = useState('')
  const [posF, setPosF] = useState<PosFilterValue>('ALL')
  const [statusF, setStatusF] = useState<StatusFilter>('ALL')
  const [teamF, setTeamF] = useState<string>('ALL')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'overall', dir: -1 })
  const [limit, setLimit] = useState(PAGE)
  const [target, setTarget] = useState<FreeAgent | null>(null)

  // In-season only: unsigned FAs can be signed straight from this directory.
  const canSign = s.phase === 'regular' && apply !== undefined

  // Deep-link from the Dashboard "Free Agents available" card: pre-filter to FAs.
  useEffect(() => {
    if (faIntent && faIntent > 0) {
      setStatusF('FA')
      setPosF('ALL')
      setLimit(PAGE)
    }
  }, [faIntent])

  const allRows = useMemo<Row[]>(() => {
    const idx = buildPlayerIndex(s)
    const rows: Row[] = []
    for (const ref of idx.values()) {
      if (ref.where === 'roster') rows.push({ player: ref.player, team: ref.team, status: 'NHL' })
      else if (ref.where === 'prospect') rows.push({ player: ref.player, team: ref.team, status: 'prospect' })
      else if (ref.where === 'freeAgent') rows.push({ player: ref.player, status: 'FA' })
    }
    return rows
  }, [s])

  const teamOptions = useMemo(
    () => Object.keys(s.teams).sort((a, b) => `${s.teams[a].city}`.localeCompare(s.teams[b].city)),
    [s.teams],
  )

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    const out = allRows.filter((r) => {
      if (!matchesPos(r.player, posF)) return false
      if (statusF !== 'ALL' && r.status !== statusF) return false
      if (teamF !== 'ALL' && r.team !== teamF) return false
      if (q && !r.player.name.toLowerCase().includes(q)) return false
      return true
    })
    out.sort((a, b) => cmp(a, b, sort.key, s) * sort.dir)
    return out
  }, [allRows, posF, statusF, teamF, q, sort, s])

  const visible = filtered.slice(0, limit)

  function th(key: SortKey, label: string, num = false, cls = '') {
    const active = sort.key === key
    return (
      <th
        className={`sortable ${num ? 'num' : ''} ${cls}`}
        onClick={() => {
          setSort((p) => ({ key, dir: p.key === key && p.dir === -1 ? 1 : -1 }))
          setLimit(PAGE)
        }}
      >
        {label}
        {active ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
      </th>
    )
  }

  return (
    <div className="stack">
      <Card
        title={`Players · ${filtered.length}`}
        right={
          <div className="row" style={{ gap: 8 }}>
            <PosFilter value={posF} onChange={(v) => { setPosF(v); setLimit(PAGE) }} />
            <SearchInput value={query} onChange={(v) => { setQuery(v); setLimit(PAGE) }} placeholder="Search players" />
          </div>
        }
      >
        <div className="card-pad row" style={{ gap: 10, borderBottom: '1px solid var(--border)' }}>
          <div className="chip-row" role="tablist" aria-label="Status filter">
            {STATUS_OPTS.map((f) => (
              <button
                key={f}
                type="button"
                className={`chip ${statusF === f ? 'active' : ''}`}
                aria-pressed={statusF === f}
                onClick={() => { setStatusF(f); setLimit(PAGE) }}
              >
                {STATUS_LABEL[f]}
              </button>
            ))}
          </div>
          <select value={teamF} onChange={(e) => { setTeamF(e.target.value); setLimit(PAGE) }} aria-label="Team filter">
            <option value="ALL">All teams</option>
            {teamOptions.map((a) => (
              <option key={a} value={a}>
                {s.teams[a].city} {s.teams[a].name}
              </option>
            ))}
          </select>
        </div>

        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {th('name', 'Player')}
                {th('team', 'Team')}
                {th('pos', 'Pos')}
                {th('age', 'Age', true, 'm-hide')}
                {th('overall', 'OVR', true)}
                {th('potential', 'POT', true, 'm-hide')}
                {th('capHit', 'Cap', true, 'm-hide')}
                {th('goals', 'G', true, 'm-hide')}
                {th('assists', 'A', true, 'm-hide')}
                {th('points', 'P', true)}
                {canSign && <th></th>}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={canSign ? 11 : 10} className="muted" style={{ textAlign: 'center', padding: 20 }}>
                    No players match those filters.
                  </td>
                </tr>
              )}
              {visible.map((r) => {
                const p = r.player
                const pot = potArrow(p.overall, p.potential)
                const line = s.stats[p.id]
                const isG = p.pos === 'G'
                return (
                  <tr key={p.id} className="clickable">
                    <td className="name-cell">
                      <PlayerLink id={p.id} player={p} team={r.team}>
                        {p.name}
                      </PlayerLink>
                    </td>
                    <td>
                      <TeamCell s={s} row={r} />
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
                    <td className="num m-hide">{p.contract ? fmtM(p.contract.capHit) : '—'}</td>
                    <td className="num m-hide">{isG ? '—' : line?.goals ?? 0}</td>
                    <td className="num m-hide">{isG ? '—' : line?.assists ?? 0}</td>
                    <td className="num">{isG ? '—' : line?.points ?? 0}</td>
                    {canSign && (
                      <td>
                        {r.status === 'FA' &&
                          ('asking' in p ? (
                            (p as FreeAgent).rightsTeam ? (
                              <span className="tag rfa" title={`Rights held by ${(p as FreeAgent).rightsTeam}`}>RFA</span>
                            ) : (
                              <button className="btn btn-sm btn-primary" onClick={() => setTarget(p as FreeAgent)}>
                                Sign
                              </button>
                            )
                          ) : null)}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {filtered.length > limit && (
          <div className="card-pad" style={{ textAlign: 'center' }}>
            <button className="btn" onClick={() => setLimit((n) => n + PAGE)}>
              Show more ({filtered.length - limit} remaining)
            </button>
          </div>
        )}
      </Card>

      {target && apply && (
        <OfferModal
          s={s}
          fa={target}
          onClose={() => setTarget(null)}
          onSubmit={(years, capHit, ntc) => {
            const r = signFreeAgent(s, target.id, years, capHit, ntc)
            if (r.ok) {
              apply(r.s)
              pushToast('success', `Signed ${target.name} — ${fmtM(capHit)} × ${years}yr.`)
              setTarget(null)
            } else {
              pushToast('error', r.reason ?? `${target.name} rejected the offer.`)
            }
          }}
        />
      )}
    </div>
  )
}

function TeamCell({ s, row }: { s: GameState; row: Row }) {
  if (row.status === 'FA' || !row.team) {
    return <span className="tag ufa">FA</span>
  }
  const t = s.teams[row.team]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <TeamLogo team={t} size={18} />
      <span>{row.team}</span>
      {row.status === 'prospect' && <span className="tag rfa">PROSPECT</span>}
    </span>
  )
}

function cmp(a: Row, b: Row, key: SortKey, s: GameState): number {
  switch (key) {
    case 'name':
      return a.player.name.localeCompare(b.player.name)
    case 'team':
      return (a.team ?? 'ZZZ').localeCompare(b.team ?? 'ZZZ')
    case 'pos':
      return posGroup(a.player.pos) - posGroup(b.player.pos) || a.player.pos.localeCompare(b.player.pos)
    case 'age':
      return a.player.age - b.player.age
    case 'overall':
      return a.player.overall - b.player.overall
    case 'potential':
      return a.player.potential - b.player.potential
    case 'capHit':
      return (a.player.contract?.capHit ?? 0) - (b.player.contract?.capHit ?? 0)
    case 'goals':
      return (s.stats[a.player.id]?.goals ?? 0) - (s.stats[b.player.id]?.goals ?? 0)
    case 'assists':
      return (s.stats[a.player.id]?.assists ?? 0) - (s.stats[b.player.id]?.assists ?? 0)
    case 'points':
      return (s.stats[a.player.id]?.points ?? 0) - (s.stats[b.player.id]?.points ?? 0)
    default:
      return 0
  }
}

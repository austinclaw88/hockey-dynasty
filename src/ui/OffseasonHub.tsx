import { useState } from 'react'
import type { GameState, Player, FreeAgent } from '../types'
import {
  advanceOffseason,
  resignPlayer,
  letWalk,
  getResignAsking,
  draftPlayer,
  getDraftBoard,
  signFreeAgent,
  advanceFreeAgencyDay,
  getCapUsage,
} from '../engine'
import { Card, OvrBadge, PosTag, CapBar, ExpiryTag, Flag } from './components'
import { fmtM, seasonLabel } from './format'
import { rosterCounts, capForYear } from './util'
import { ROSTER_MIN, ROSTER_MAX, SEASONS_TOTAL } from '../types'

type Step = NonNullable<GameState['offseasonStep']>
const ORDER: Step[] = ['awards', 'development', 'resign', 'draft', 'freeAgency', 'rosterCheck']
const STEP_LABEL: Record<Step, string> = {
  awards: 'Awards',
  development: 'Development',
  resign: 'Re-Sign',
  draft: 'Draft',
  freeAgency: 'Free Agency',
  rosterCheck: 'Roster Check',
}

export type DevSnapshot = Record<string, { overall: number; age: number; name: string; pos: string }>

export function OffseasonHub({
  s,
  apply,
  devSnap,
  onSnapshot,
}: {
  s: GameState
  apply: (n: GameState) => void
  devSnap: DevSnapshot
  onSnapshot: (snap: DevSnapshot) => void
}) {
  const step = s.offseasonStep ?? 'awards'
  const curIdx = ORDER.indexOf(step)

  return (
    <div className="stack">
      <div className="stepper">
        {ORDER.map((st, i) => (
          <div key={st} className={`step ${st === step ? 'active' : i < curIdx ? 'done' : ''}`}>
            <span className="n">{i < curIdx ? '✓' : i + 1}</span>
            {STEP_LABEL[st]}
          </div>
        ))}
      </div>

      {step === 'awards' && <AwardsStep s={s} apply={apply} onSnapshot={onSnapshot} />}
      {step === 'development' && <DevelopmentStep s={s} apply={apply} devSnap={devSnap} />}
      {step === 'resign' && <ResignStep s={s} apply={apply} />}
      {step === 'draft' && <DraftStep s={s} apply={apply} />}
      {step === 'freeAgency' && <FreeAgencyStep s={s} apply={apply} />}
      {step === 'rosterCheck' && <RosterCheckStep s={s} apply={apply} />}
    </div>
  )
}

// ---------------- Awards ----------------

function AwardsStep({ s, apply, onSnapshot }: { s: GameState; apply: (n: GameState) => void; onSnapshot: (snap: DevSnapshot) => void }) {
  const summary = s.history[s.history.length - 1]
  function next() {
    // Snapshot current user overalls BEFORE development is applied on advance.
    const snap: DevSnapshot = {}
    const t = s.teams[s.userTeam]
    for (const p of [...t.roster, ...t.prospects]) {
      snap[p.id] = { overall: p.overall, age: p.age, name: p.name, pos: p.pos }
    }
    onSnapshot(snap)
    apply(advanceOffseason(s))
  }
  return (
    <div className="stack">
      <div className="banner playoffs">
        <div className="banner-body">
          <h4>{summary ? `${seasonLabel(summary.year)} Awards` : 'Season Awards'}</h4>
          <p>{summary ? `Stanley Cup: ${s.teams[summary.cupWinner]?.city} ${s.teams[summary.cupWinner]?.name}` : 'Recognizing the season’s best.'}</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={next}>
          Continue to Development →
        </button>
      </div>
      {summary && summary.awards.length > 0 ? (
        <div className="award-grid">
          {summary.awards.map((a, i) => (
            <div className="award" key={i}>
              <div className="trophy">{a.name}</div>
              <div className="winner">{a.playerName}</div>
              <div className="team">
                {s.teams[a.team]?.city} {s.teams[a.team]?.name}
                {a.team === s.userTeam ? ' ★' : ''}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card title="Awards">
          <div className="news-empty">Awards will be presented here.</div>
        </Card>
      )}
    </div>
  )
}

// ---------------- Development ----------------

function DevelopmentStep({ s, apply, devSnap }: { s: GameState; apply: (n: GameState) => void; devSnap: DevSnapshot }) {
  const t = s.teams[s.userTeam]
  const current = [...t.roster, ...t.prospects]
  const currentIds = new Set(current.map((p) => p.id))
  const departed = Object.entries(devSnap).filter(([id]) => !currentIds.has(id))
  const hasSnap = Object.keys(devSnap).length > 0

  return (
    <div className="stack">
      <div className="banner">
        <div className="banner-body">
          <h4>Player Development</h4>
          <p>Another year older. Young players grow toward their ceiling; veterans start to slip.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => apply(advanceOffseason(s))}>
          Continue to Re-Signings →
        </button>
      </div>

      {!hasSnap && (
        <div className="notice">
          Development deltas are unavailable (the pre-development snapshot was lost, e.g. after a reload). Current
          ratings are shown.
        </div>
      )}

      <Card title="Your Players — Rating Changes">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th>Pos</th>
                <th className="num">Age</th>
                <th className="num">Was</th>
                <th className="num">Now</th>
                <th className="num">Δ</th>
                <th className="num">POT</th>
              </tr>
            </thead>
            <tbody>
              {[...current]
                .sort((a, b) => b.overall - a.overall)
                .map((p) => {
                  const prev = devSnap[p.id]
                  const delta = prev ? p.overall - prev.overall : 0
                  return (
                    <tr key={p.id}>
                      <td className="name-cell">
                        {p.name} <Flag nat={p.nationality} />
                      </td>
                      <td><PosTag pos={p.pos} /></td>
                      <td className="num">{p.age}</td>
                      <td className="num muted">{prev ? prev.overall : '—'}</td>
                      <td className="num"><OvrBadge overall={p.overall} /></td>
                      <td className="num">
                        {prev ? (
                          <span className={delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'delta-flat'}>
                            {delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${delta}` : '—'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num">{p.potential}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </Card>

      {departed.length > 0 && (
        <Card title="Retired / Departed">
          <div className="table-wrap">
            <table className="tbl">
              <tbody>
                {departed.map(([id, v]) => (
                  <tr key={id}>
                    <td className="name-cell">{v.name}</td>
                    <td><PosTag pos={v.pos} /></td>
                    <td className="num muted">was {v.overall} OVR</td>
                    <td className="muted">no longer on your roster</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ---------------- Re-sign ----------------

function ResignStep({ s, apply }: { s: GameState; apply: (n: GameState) => void }) {
  const t = s.teams[s.userTeam]
  const expiring = t.roster.filter((p) => p.contract && p.contract.yearsLeft <= 0)
  const cap = getCapUsage(s, s.userTeam)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <div className="stack">
      <div className="banner">
        <div className="banner-body">
          <h4>Re-Sign Your Own</h4>
          <p>Lock up your expiring contracts before they hit the open market. Anyone left unsigned becomes a free agent.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => apply(advanceOffseason(s))}>
          Continue to Draft →
        </button>
      </div>

      <Card title="Salary Cap">
        <div className="card-pad"><CapBar used={cap.used} cap={cap.cap} /></div>
      </Card>

      {notice && <div className="notice err">{notice}</div>}

      {expiring.length === 0 ? (
        <Card title="Expiring Contracts">
          <div className="news-empty">No expiring contracts to resolve. On to the draft.</div>
        </Card>
      ) : (
        expiring.map((p) => <ResignRow key={p.id} s={s} apply={apply} player={p} setNotice={setNotice} />)
      )}
    </div>
  )
}

function ResignRow({ s, apply, player, setNotice }: { s: GameState; apply: (n: GameState) => void; player: Player; setNotice: (m: string | null) => void }) {
  const asking = getResignAsking(s, player.id)
  const [years, setYears] = useState(asking.years)
  const [capHit, setCapHit] = useState(asking.capHit)

  function sign() {
    const r = resignPlayer(s, player.id, years, capHit)
    if (r.ok) { apply(r.s); setNotice(null) }
    else setNotice(r.reason ?? `${player.name} rejected the offer.`)
  }
  function walk() {
    apply(letWalk(s, player.id))
    setNotice(null)
  }

  return (
    <Card>
      <div className="card-pad">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 10 }}>
            <OvrBadge overall={player.overall} />
            <div>
              <div className="name-cell">
                {player.name} <PosTag pos={player.pos} />
                {player.contract && <ExpiryTag expiry={player.contract.expiry} />}
              </div>
              <div className="hint">
                Age {player.age} · Asking {fmtM(asking.capHit)} × {asking.years}yr
              </div>
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 18, alignItems: 'flex-end' }}>
          <SliderField label={`Cap Hit — ${fmtM(capHit)}`} min={0.775} max={17} step={0.05} value={capHit} onChange={setCapHit} />
          <SliderField label={`Years — ${years}`} min={1} max={8} step={1} value={years} onChange={setYears} />
          <button className="btn btn-primary" onClick={sign}>Sign</button>
          <button className="btn btn-danger" onClick={walk}>Let Walk</button>
        </div>
      </div>
    </Card>
  )
}

// ---------------- Draft ----------------

function potentialBand(pos: string, potential: number): string {
  const isG = pos === 'G'
  const isD = pos === 'D'
  if (potential >= 90) return isG ? 'Franchise G' : 'Franchise'
  if (potential >= 86) return isD ? '#1 D' : isG ? 'Starter G' : 'Top-line'
  if (potential >= 83) return isD ? 'Top-4 D' : isG ? '1B Goalie' : 'Top-6 F'
  if (potential >= 79) return isD ? '#4-5 D' : isG ? 'Backup G' : 'Middle-six'
  if (potential >= 75) return isD ? 'Depth D' : isG ? '3rd G' : 'Bottom-six'
  return 'Project'
}

function DraftStep({ s, apply }: { s: GameState; apply: (n: GameState) => void }) {
  const board = getDraftBoard(s)
  const [posFilter, setPosFilter] = useState<'ALL' | 'F' | 'D' | 'G'>('ALL')
  const onUserClock = board.onClock === s.userTeam
  const draftDone = board.available.length === 0 || board.pickNumber > 64

  const filtered = board.available.filter((p) => {
    if (posFilter === 'ALL') return true
    if (posFilter === 'G') return p.pos === 'G'
    if (posFilter === 'D') return p.pos === 'D'
    return p.pos === 'C' || p.pos === 'LW' || p.pos === 'RW'
  })

  return (
    <div className="stack">
      <div className={`banner ${onUserClock ? 'playoffs' : ''}`}>
        <div className="banner-body">
          <h4>{draftDone ? 'Draft Complete' : onUserClock ? `You are on the clock — Pick #${board.pickNumber}` : `Pick #${board.pickNumber} — ${s.teams[board.onClock]?.name ?? board.onClock}`}</h4>
          <p>{draftDone ? 'All 64 picks are in.' : onUserClock ? 'Select the best available prospect for your future.' : 'AI teams are making their selections.'}</p>
        </div>
        {draftDone && (
          <button className="btn btn-primary btn-lg" onClick={() => apply(advanceOffseason(s))}>
            Continue to Free Agency →
          </button>
        )}
      </div>

      <div className="grid dash-grid">
        <Card
          title="Best Available"
          right={
            <div className="row" style={{ gap: 4 }}>
              {(['ALL', 'F', 'D', 'G'] as const).map((f) => (
                <button key={f} className={`subtab ${posFilter === f ? 'active' : ''}`} onClick={() => setPosFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
          }
        >
          <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Prospect</th>
                  <th>Pos</th>
                  <th className="num">Age</th>
                  <th className="num">OVR</th>
                  <th>Projection</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td className="name-cell">{p.name} <Flag nat={p.nationality} /></td>
                    <td><PosTag pos={p.pos} /></td>
                    <td className="num">{p.age}</td>
                    <td className="num"><OvrBadge overall={p.overall} /></td>
                    <td><span className="tag">{potentialBand(p.pos, p.potential)}</span></td>
                    <td>
                      {onUserClock && (
                        <button className="btn btn-sm btn-primary" onClick={() => apply(draftPlayer(s, p.id))}>
                          Draft
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Draft Board">
          <div className="ticker" style={{ maxHeight: 520 }}>
            <table className="tbl">
              <tbody>
                {[...board.results].reverse().map((r) => (
                  <tr key={r.pick} className={r.team === s.userTeam ? 'me' : ''}>
                    <td className="num muted" style={{ width: 34 }}>{r.pick}</td>
                    <td>{r.team}</td>
                    <td className="name-cell">{r.playerName}</td>
                  </tr>
                ))}
                {board.results.length === 0 && (
                  <tr><td className="muted">No picks made yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}

// ---------------- Free Agency ----------------

function FreeAgencyStep({ s, apply }: { s: GameState; apply: (n: GameState) => void }) {
  const cap = getCapUsage(s, s.userTeam)
  const [target, setTarget] = useState<FreeAgent | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const fas = [...s.freeAgents].sort((a, b) => b.overall - a.overall)

  return (
    <div className="stack">
      <div className="banner">
        <div className="banner-body">
          <h4>Free Agency</h4>
          <p>Bid on the open market. Advance the day to let rival GMs make their moves. Trades are also open now.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => { apply(advanceFreeAgencyDay(s)); setNotice(null) }}>
            Advance FA Day
          </button>
          <button className="btn btn-primary btn-lg" onClick={() => apply(advanceOffseason(s))}>
            Finish Free Agency →
          </button>
        </div>
      </div>

      <Card title="Salary Cap">
        <div className="card-pad"><CapBar used={cap.used} cap={cap.cap} /></div>
      </Card>

      {notice && <div className={`notice ${notice.kind === 'err' ? 'err' : ''}`}>{notice.text}</div>}

      <div className="grid dash-grid">
        <Card title={`Available Free Agents · ${fas.length}`}>
          <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Pos</th>
                  <th className="num">Age</th>
                  <th className="num">OVR</th>
                  <th className="num">Asking</th>
                  <th className="num">Yrs</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {fas.length === 0 && <tr><td className="muted">The market is dry.</td></tr>}
                {fas.map((p) => (
                  <tr key={p.id}>
                    <td className="name-cell">{p.name} <Flag nat={p.nationality} /></td>
                    <td><PosTag pos={p.pos} /></td>
                    <td className="num">{p.age}</td>
                    <td className="num"><OvrBadge overall={p.overall} /></td>
                    <td className="num">{fmtM(p.asking.capHit)}</td>
                    <td className="num">{p.asking.years}</td>
                    <td>
                      <button className="btn btn-sm btn-primary" onClick={() => setTarget(p)}>Offer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Signing Ticker">
          <div className="news ticker" style={{ maxHeight: 520 }}>
            {[...s.news].slice(-40).reverse().map((n, i) => (
              <div className="news-item" key={i}>
                <span>{n.text}</span>
              </div>
            ))}
            {s.news.length === 0 && <div className="news-empty">No signings yet.</div>}
          </div>
        </Card>
      </div>

      {target && (
        <OfferModal
          fa={target}
          onClose={() => setTarget(null)}
          onSubmit={(years, capHit) => {
            const r = signFreeAgent(s, target.id, years, capHit)
            if (r.ok) {
              apply(r.s)
              setNotice({ kind: 'ok', text: `Signed ${target.name}.` })
              setTarget(null)
            } else {
              setNotice({ kind: 'err', text: r.reason ?? `${target.name} rejected the offer.` })
            }
          }}
        />
      )}
    </div>
  )
}

function OfferModal({ fa, onClose, onSubmit }: { fa: FreeAgent; onClose: () => void; onSubmit: (years: number, capHit: number) => void }) {
  const [years, setYears] = useState(fa.asking.years)
  const [capHit, setCapHit] = useState(fa.asking.capHit)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">
            <h3>{fa.name}</h3>
            <div className="meta">{fa.pos} · Age {fa.age} · {fa.overall} OVR · Asking {fmtM(fa.asking.capHit)} × {fa.asking.years}yr</div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="stack">
            <SliderField label={`Cap Hit — ${fmtM(capHit)}`} min={0.775} max={17} step={0.05} value={capHit} onChange={setCapHit} />
            <SliderField label={`Years — ${years}`} min={1} max={8} step={1} value={years} onChange={setYears} />
            <div className="hint">Offer at or above the asking price to land the player. Lowballs may be rejected.</div>
            <div className="row">
              <button className="btn btn-primary btn-lg" onClick={() => onSubmit(years, capHit)}>Submit Offer</button>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------- Roster Check ----------------

function RosterCheckStep({ s, apply }: { s: GameState; apply: (n: GameState) => void }) {
  const t = s.teams[s.userTeam]
  const counts = rosterCounts(t.roster)
  const cap = getCapUsage(s, s.userTeam)
  const nextYear = s.seasonYear + 1
  const nextCap = capForYear(nextYear)
  const problems: string[] = []
  if (counts.total < ROSTER_MIN) problems.push(`Roster has ${counts.total} players — need at least ${ROSTER_MIN}.`)
  if (counts.total > ROSTER_MAX) problems.push(`Roster has ${counts.total} players — max is ${ROSTER_MAX}.`)
  if (counts.g < 2) problems.push(`Only ${counts.g} goalies — need at least 2.`)
  if (counts.d < 6) problems.push(`Only ${counts.d} defensemen — need at least 6.`)
  if (counts.f < 12) problems.push(`Only ${counts.f} forwards — need at least 12.`)
  if (cap.used > cap.cap) problems.push(`Over the cap by ${fmtM(cap.used - cap.cap)}.`)
  const lastSeason = s.seasonIndex + 1 >= SEASONS_TOTAL

  return (
    <div className="stack">
      <div className="banner">
        <div className="banner-body">
          <h4>Roster Check</h4>
          <p>Make sure the roster is legal for {seasonLabel(nextYear)} before starting the season.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => apply(advanceOffseason(s))}>
          {lastSeason ? 'Finish Dynasty' : `Start ${seasonLabel(nextYear)} →`}
        </button>
      </div>

      <div className="tiles">
        <TileMini k="Forwards" v={counts.f} ok={counts.f >= 12} />
        <TileMini k="Defensemen" v={counts.d} ok={counts.d >= 6} />
        <TileMini k="Goalies" v={counts.g} ok={counts.g >= 2} />
        <TileMini k="Total" v={counts.total} ok={counts.total >= ROSTER_MIN && counts.total <= ROSTER_MAX} />
      </div>

      <Card title={`Projected Cap · ${seasonLabel(nextYear)} (cap ${fmtM(nextCap)})`}>
        <div className="card-pad"><CapBar used={cap.used} cap={nextCap} /></div>
      </Card>

      {problems.length > 0 ? (
        <div className="notice">
          <strong>Heads up:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
          <div style={{ marginTop: 6 }}>The front office will auto-fill any gaps with depth signings when the season starts.</div>
        </div>
      ) : (
        <div className="notice" style={{ background: 'color-mix(in srgb, var(--good) 10%, var(--card))', borderColor: 'color-mix(in srgb, var(--good) 35%, transparent)', color: 'var(--good)' }}>
          Roster is legal and cap-compliant. Ready to drop the puck.
        </div>
      )}
    </div>
  )
}

function TileMini({ k, v, ok }: { k: string; v: number; ok: boolean }) {
  return (
    <div className="tile">
      <div className="k">{k}</div>
      <div className="v" style={{ color: ok ? undefined : 'var(--bad)' }}>
        {v} {ok ? '' : '⚠'}
      </div>
    </div>
  )
}

// ---------------- shared ----------------

function SliderField({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (n: number) => void }) {
  return (
    <div className="field" style={{ minWidth: 180, flex: 1 }}>
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

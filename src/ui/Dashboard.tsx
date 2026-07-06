import { useState } from 'react'
import type { GameState, Game } from '../types'
import { getStandings, getCapUsage, simDays, simToEndOfSeason } from '../engine'
import { Card, CapBar, TeamLogo, TeamLink } from './components'
import { BoxScoreModal } from './BoxScore'
import { nextGames, recentGames, teamOverall, dayLabel } from './util'
import { seasonLabel, ordinal } from './format'
import type { TabKey } from './TabNav'

const DEADLINE_DAY = 120

type FormResult = 'W' | 'L' | 'OTL'

/** Result of a played game from `team`'s perspective. */
function resultFor(g: Game, team: string): FormResult {
  const forGoals = g.home === team ? g.homeGoals ?? 0 : g.awayGoals ?? 0
  const oppGoals = g.home === team ? g.awayGoals ?? 0 : g.homeGoals ?? 0
  if (forGoals > oppGoals) return 'W'
  if (g.endType === 'OT' || g.endType === 'SO') return 'OTL'
  return 'L'
}

export function Dashboard({
  s,
  apply,
  onNavigate,
  busy,
}: {
  s: GameState
  apply: (next: GameState) => void
  onNavigate: (t: TabKey) => void
  busy: boolean
}) {
  const team = s.teams[s.userTeam]
  const [boxGame, setBoxGame] = useState<Game | null>(null)
  const standings = getStandings(s)
  const divRows = standings.byDivision[team.division] ?? []
  const rank = divRows.findIndex((r) => r.team === s.userTeam) + 1
  const cap = getCapUsage(s, s.userTeam)
  const upcoming = nextGames(s, s.userTeam, 5)
  const regularDone = !s.schedule.some((g) => !g.played)

  function sim(days: number) {
    apply(simDays(s, days))
  }

  const canSim = s.phase === 'regular' && !regularDone

  return (
    <div className="stack">
      <PhaseBanner s={s} onNavigate={onNavigate} regularDone={regularDone} />

      <div className="tiles">
        <Tile k="Division Rank" v={rank > 0 ? ordinal(rank) : '—'} sub={team.division} />
        <Tile k="Points" v={String(userPts(standings, s.userTeam))} sub={`${gp(standings, s.userTeam)} GP`} />
        <Tile k="Team Overall" v={teamOverall(team.roster).toFixed(1)} sub="avg top 20" />
        <Tile k="Day" v={`${s.day}`} sub={dayLabel(s.day)} />
      </div>

      {canSim && (
        <Card title="Simulate">
          <div className="card-pad row">
            <button className="btn btn-primary" disabled={busy} onClick={() => sim(1)}>
              Sim Day
            </button>
            <button className="btn" disabled={busy} onClick={() => sim(7)}>
              Sim Week
            </button>
            <button className="btn" disabled={busy} onClick={() => sim(30)}>
              Sim Month
            </button>
            <button
              className="btn"
              disabled={busy || s.day >= DEADLINE_DAY}
              onClick={() => sim(DEADLINE_DAY - s.day)}
              title="Trade deadline is day 120"
            >
              Sim to Deadline
            </button>
            <button className="btn" disabled={busy} onClick={() => apply(simToEndOfSeason(s))}>
              Sim to End of Season
            </button>
          </div>
        </Card>
      )}

      <FormStrip s={s} onOpenBox={setBoxGame} />

      <div className="grid dash-grid">
        <Card title="News & Transactions">
          <NewsFeed s={s} />
        </Card>

        <div className="stack">
          <OffersCard s={s} onNavigate={onNavigate} />

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

          <Card title="Next 5 Games">
            {upcoming.length === 0 ? (
              <div className="news-empty">No games remaining.</div>
            ) : (
              upcoming.map((g) => {
                const oppAbbrev = g.home === s.userTeam ? g.away : g.home
                const opp = s.teams[oppAbbrev]
                const home = g.home === s.userTeam
                return (
                  <div className="game-row" key={g.id}>
                    <span className="game-when">{dayLabel(g.day)}</span>
                    <TeamLink abbrev={oppAbbrev} className="game-opp-link">
                      <TeamLogo team={opp} size={22} />
                      <span className="game-opp">
                        <span className="ha">{home ? 'vs' : '@'}</span>
                        {opp?.name ?? oppAbbrev}
                      </span>
                    </TeamLink>
                    <span className="strength">OVR {teamOverall(opp?.roster ?? []).toFixed(0)}</span>
                  </div>
                )
              })
            )}
          </Card>
        </div>
      </div>

      {boxGame && <BoxScoreModal s={s} game={boxGame} onClose={() => setBoxGame(null)} />}
    </div>
  )
}

function OffersCard({ s, onNavigate }: { s: GameState; onNavigate: (t: TabKey) => void }) {
  const offers = s.pendingOffers
  return (
    <Card title={offers.length > 0 ? `Trade Offers · ${offers.length}` : 'Trade Offers'}>
      <div className="card-pad stack" style={{ gap: 10 }}>
        {offers.length === 0 ? (
          <div className="hint">No offers yet. Put players on the trade block to attract calls.</div>
        ) : (
          <>
            {offers.slice(0, 3).map((o) => {
              const fromTeam = s.teams[o.offer.to] // the AI team that sent the offer
              return (
                <div className="offer-mini" key={o.id}>
                  <TeamLogo team={fromTeam} size={22} />
                  <span className="offer-mini-team">{fromTeam?.name ?? o.offer.to}</span>
                  <span className="hint">
                    wants {o.offer.fromPlayers.length + o.offer.fromPicks.length} · offers{' '}
                    {o.offer.toPlayers.length + o.offer.toPicks.length}
                  </span>
                </div>
              )
            })}
            <button className="btn btn-primary" onClick={() => onNavigate('trades')}>
              Review offers →
            </button>
          </>
        )}
      </div>
    </Card>
  )
}

function FormStrip({ s, onOpenBox }: { s: GameState; onOpenBox: (g: Game) => void }) {
  const last10 = [...recentGames(s, s.userTeam, 10)].reverse() // most recent last
  const last5 = recentGames(s, s.userTeam, 5) // newest first
  if (last10.length === 0) return null
  return (
    <div className="grid dash-grid">
      <Card title="Form — Last 10">
        <div className="card-pad">
          <div className="form-strip">
            {last10.map((g) => {
              const r = resultFor(g, s.userTeam)
              const oppAbbrev = g.home === s.userTeam ? g.away : g.home
              const opp = s.teams[oppAbbrev]
              const forGoals = g.home === s.userTeam ? g.homeGoals ?? 0 : g.awayGoals ?? 0
              const oppGoals = g.home === s.userTeam ? g.awayGoals ?? 0 : g.homeGoals ?? 0
              return (
                <span
                  key={g.id}
                  className={`form-sq ${r.toLowerCase()}`}
                  title={`${r} ${forGoals}-${oppGoals} vs ${opp?.name ?? oppAbbrev}${
                    g.endType && g.endType !== 'REG' ? ` (${g.endType})` : ''
                  }`}
                >
                  {r === 'OTL' ? 'O' : r}
                </span>
              )
            })}
          </div>
        </div>
      </Card>
      <Card title="Recent Results">
        {last5.length === 0 ? (
          <div className="news-empty">No games played yet.</div>
        ) : (
          last5.map((g) => {
            const r = resultFor(g, s.userTeam)
            const oppAbbrev = g.home === s.userTeam ? g.away : g.home
            const opp = s.teams[oppAbbrev]
            const home = g.home === s.userTeam
            const forGoals = g.home === s.userTeam ? g.homeGoals ?? 0 : g.awayGoals ?? 0
            const oppGoals = g.home === s.userTeam ? g.awayGoals ?? 0 : g.homeGoals ?? 0
            return (
              <div
                className="game-row clickable-row"
                key={g.id}
                role="button"
                tabIndex={0}
                title="View box score"
                onClick={() => onOpenBox(g)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onOpenBox(g)
                }}
              >
                <span className={`result-pill ${r.toLowerCase()}`}>{r}</span>
                <span className="game-when">{dayLabel(g.day)}</span>
                <TeamLink abbrev={oppAbbrev} className="game-opp-link">
                  <TeamLogo team={opp} size={20} />
                  <span className="game-opp">
                    <span className="ha">{home ? 'vs' : '@'}</span>
                    {opp?.name ?? oppAbbrev}
                  </span>
                </TeamLink>
                <span className="strength num">
                  {forGoals}-{oppGoals}
                  {g.endType && g.endType !== 'REG' ? ` ${g.endType}` : ''}
                </span>
              </div>
            )
          })
        )}
      </Card>
    </div>
  )
}

function PhaseBanner({
  s,
  onNavigate,
  regularDone,
}: {
  s: GameState
  onNavigate: (t: TabKey) => void
  regularDone: boolean
}) {
  if (s.phase === 'playoffs') {
    return (
      <div className="banner playoffs">
        <div className="banner-body">
          <h4>Playoffs are underway</h4>
          <p>Best-of-7 bracket. Advance your run round by round.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => onNavigate('playoffs')}>
          Go to Playoffs →
        </button>
      </div>
    )
  }
  if (s.phase === 'offseason') {
    return (
      <div className="banner">
        <div className="banner-body">
          <h4>The offseason has begun</h4>
          <p>Awards, development, re-signings, the draft and free agency await.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => onNavigate('offseason')}>
          Go to Offseason Hub →
        </button>
      </div>
    )
  }
  if (s.phase === 'over') {
    return (
      <div className="banner over">
        <div className="banner-body">
          <h4>Your dynasty is complete</h4>
          <p>Ten seasons in the books. Review the legacy you built.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => onNavigate('history')}>
          View History →
        </button>
      </div>
    )
  }
  if (regularDone) {
    return (
      <div className="banner playoffs">
        <div className="banner-body">
          <h4>Regular season complete</h4>
          <p>Seeds are set. Time for the postseason.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => onNavigate('playoffs')}>
          Enter Playoffs →
        </button>
      </div>
    )
  }
  return (
    <div className="banner">
      <div className="banner-body">
        <h4>{seasonLabel(s.seasonYear)} — chasing the Cup</h4>
        <p>Manage the roster, work the phones, and sim toward the playoffs.</p>
      </div>
    </div>
  )
}

function NewsFeed({ s }: { s: GameState }) {
  const items = s.news.slice(0, 60) // engine stores news newest-first
  if (items.length === 0) {
    return <div className="news-empty">No news yet. Sim some games to get things rolling.</div>
  }
  return (
    <div className="news">
      {items.map((n, i) => (
        <div className="news-item" key={i}>
          <span className="news-day">{dayLabel(n.day)}</span>
          <span>{n.text}</span>
        </div>
      ))}
    </div>
  )
}

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="k">{k}</div>
      <div className="v">
        {v} {sub && <small>{sub}</small>}
      </div>
    </div>
  )
}

function userPts(st: ReturnType<typeof getStandings>, team: string): number {
  return st.league.find((r) => r.team === team)?.pts ?? 0
}
function gp(st: ReturnType<typeof getStandings>, team: string): number {
  return st.league.find((r) => r.team === team)?.gp ?? 0
}

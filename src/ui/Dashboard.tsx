import { useState } from 'react'
import type { GameState, Game, StandingsRow } from '../types'
import { getStandings, getCapUsage, simDays, simToEndOfSeason } from '../engine'
import { Card, CapBar, TeamLogo, TeamLink } from './components'
import { IncomingSheetsPanel, RosterStatusStrip, rosterStatus } from './signing'
import { BoxScoreModal } from './BoxScore'
import { LiveGameModal } from './LiveGame'
import { ScheduleModal } from './ScheduleModal'
import { nextGames, recentGames, teamOverall, dayLabel } from './util'
import { seasonLabel, ordinal, fmtRecord } from './format'
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
  onBrowseFA,
  busy,
}: {
  s: GameState
  apply: (next: GameState) => void
  onNavigate: (t: TabKey) => void
  onBrowseFA?: () => void
  busy: boolean
}) {
  const team = s.teams[s.userTeam]
  const [boxGame, setBoxGame] = useState<Game | null>(null)
  const [liveGame, setLiveGame] = useState<Game | null>(null)
  const [showSchedule, setShowSchedule] = useState(false)
  const standings = getStandings(s)
  const divRows = standings.byDivision[team.division] ?? []
  const rank = divRows.findIndex((r) => r.team === s.userTeam) + 1
  const userRow = standings.league.find((r) => r.team === s.userTeam)
  const cap = getCapUsage(s, s.userTeam)
  const upcoming = nextGames(s, s.userTeam, 5)
  const regularDone = !s.schedule.some((g) => !g.played)

  function sim(days: number) {
    apply(simDays(s, days))
  }

  const canSim = s.phase === 'regular' && !regularDone
  // The user's game on the CURRENT day, if one is scheduled and unplayed.
  const todayGame = s.schedule.find(
    (g) => g.day === s.day && !g.played && (g.home === s.userTeam || g.away === s.userTeam),
  )

  function playToday() {
    if (!todayGame) return
    const next = simDays(s, 1)
    const played = next.schedule.find((g) => g.id === todayGame.id)
    apply(next)
    if (played && played.played) setLiveGame(played)
  }

  const nextGame = upcoming[0]

  return (
    <div className="dash">
      {/* Hero scoreboard band — no card chrome; sits on the base. */}
      <section className="hero">
        <div className="hero-id">
          <div className="hero-eyebrow">
            <span>{seasonLabel(s.seasonYear)}</span>
            <span className="dot">·</span>
            <span>{phaseEyebrow(s, regularDone)}</span>
            {rank > 0 && (
              <>
                <span className="dot">·</span>
                <span>
                  {ordinal(rank)} in {team.division}
                </span>
              </>
            )}
          </div>
          <div className="hero-team">
            <TeamLogo team={team} size={54} fallback={<span className="hero-crest">{team.abbrev}</span>} />
            <div className="hero-team-names">
              <div className="hero-city">{team.city}</div>
              <div className="hero-name">{team.name}</div>
            </div>
          </div>
          {userRow && (
            <div className="hero-record">
              <span className="hero-rec-num">{fmtRecord(userRow.w, userRow.l, userRow.otl)}</span>
              <span className="hero-rec-sub">
                {userRow.pts} PTS · {userRow.gp} GP · {teamOverall(team.roster).toFixed(1)} OVR
              </span>
            </div>
          )}
        </div>

        <div className="hero-action">
          <HeroAction
            s={s}
            regularDone={regularDone}
            nextGame={nextGame}
            todayGame={!!todayGame}
            busy={busy}
            canSim={canSim}
            onPlay={playToday}
            onSim={sim}
            onSimEnd={() => apply(simToEndOfSeason(s))}
            onNavigate={onNavigate}
          />
        </div>
      </section>

      <IncomingSheetsPanel s={s} apply={apply} />

      <div className="dash-cols">
        {/* LEFT — division snapshot + form + recent results */}
        <div className="dash-col stack">
          <StandingsSnapshot rows={divRows} userTeam={s.userTeam} teams={s.teams} onNavigate={onNavigate} />
          <FormCard s={s} onOpenBox={setBoxGame} />
        </div>

        {/* CENTER — news feed */}
        <div className="dash-col stack">
          <Card title="News & Transactions">
            <NewsFeed s={s} />
          </Card>
        </div>

        {/* RIGHT — offers, cap, upcoming */}
        <div className="dash-col stack">
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

          {s.phase === 'regular' && (s.freeAgents.length > 0 || rosterStatus(team.roster).belowMin) && (
            <Card title={`Free Agents Available · ${s.freeAgents.length}`}>
              <div className="card-pad stack" style={{ gap: 10 }}>
                {rosterStatus(team.roster).belowMin && <RosterStatusStrip roster={team.roster} />}
                <div className="hint">Unsigned veterans are still on the market. Their asking prices soften as the season wears on.</div>
                <button className="btn btn-primary" onClick={() => (onBrowseFA ? onBrowseFA() : onNavigate('players'))}>
                  Browse free agents →
                </button>
              </div>
            </Card>
          )}

          <Card
            title="Next 5 Games"
            right={
              <button className="btn btn-sm btn-ghost" onClick={() => setShowSchedule(true)}>
                Full Schedule
              </button>
            }
          >
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
      {liveGame && <LiveGameModal s={s} game={liveGame} onClose={() => setLiveGame(null)} />}
      {showSchedule && <ScheduleModal s={s} onClose={() => setShowSchedule(false)} />}
    </div>
  )
}

function phaseEyebrow(s: GameState, regularDone: boolean): string {
  if (s.phase === 'playoffs') return 'Playoffs'
  if (s.phase === 'offseason') return 'Offseason'
  if (s.phase === 'over') return 'Dynasty Complete'
  if (regularDone) return 'Regular Season Complete'
  return 'Regular Season'
}

/**
 * Right side of the hero. During the regular season it's the next-game panel
 * plus integrated Play/Sim controls; in other phases it's the phase CTA.
 */
function HeroAction({
  s,
  regularDone,
  nextGame,
  todayGame,
  busy,
  canSim,
  onPlay,
  onSim,
  onSimEnd,
  onNavigate,
}: {
  s: GameState
  regularDone: boolean
  nextGame?: Game
  todayGame: boolean
  busy: boolean
  canSim: boolean
  onPlay: () => void
  onSim: (days: number) => void
  onSimEnd: () => void
  onNavigate: (t: TabKey) => void
}) {
  if (s.phase === 'playoffs' || (regularDone && s.phase === 'regular')) {
    return (
      <div className="hero-cta">
        <div className="hero-cta-text">
          <div className="hero-cta-title">{regularDone ? 'Regular season complete' : 'Playoffs are underway'}</div>
          <p>{regularDone ? 'Seeds are set — time for the postseason.' : 'Best-of-7 bracket. Advance round by round.'}</p>
        </div>
        <button className="btn btn-primary btn-lg btn-mblock" onClick={() => onNavigate('playoffs')}>
          {regularDone ? 'Enter Playoffs →' : 'Go to Playoffs →'}
        </button>
      </div>
    )
  }
  if (s.phase === 'offseason') {
    return (
      <div className="hero-cta">
        <div className="hero-cta-text">
          <div className="hero-cta-title">The offseason has begun</div>
          <p>Awards, development, re-signings, the draft and free agency await.</p>
        </div>
        <button className="btn btn-primary btn-lg btn-mblock" onClick={() => onNavigate('offseason')}>
          Go to Offseason Hub →
        </button>
      </div>
    )
  }
  if (s.phase === 'over') {
    return (
      <div className="hero-cta">
        <div className="hero-cta-text">
          <div className="hero-cta-title">Your dynasty is complete</div>
          <p>Ten seasons in the books. Review the legacy you built.</p>
        </div>
        <button className="btn btn-primary btn-lg btn-mblock" onClick={() => onNavigate('history')}>
          View History →
        </button>
      </div>
    )
  }

  // Regular season: next-game marquee + control deck.
  const opp = nextGame ? s.teams[nextGame.home === s.userTeam ? nextGame.away : nextGame.home] : undefined
  const oppAbbrev = nextGame ? (nextGame.home === s.userTeam ? nextGame.away : nextGame.home) : undefined
  const home = nextGame ? nextGame.home === s.userTeam : false
  return (
    <div className="hero-play">
      <div className="hero-next-label">Next Game</div>
      {nextGame && opp ? (
        <div className="hero-next">
          <span className="hero-next-when">{dayLabel(nextGame.day)}</span>
          <span className="hero-next-ha">{home ? 'vs' : '@'}</span>
          <TeamLink abbrev={oppAbbrev} className="hero-next-opp">
            <TeamLogo team={opp} size={30} />
            <span className="hero-next-name">{opp.name}</span>
          </TeamLink>
          <span className="hero-next-str">OVR {teamOverall(opp.roster).toFixed(0)}</span>
        </div>
      ) : (
        <div className="hero-next hero-next-empty">No games remaining.</div>
      )}
      {canSim && (
        <div className="hero-controls-deck">
          {todayGame && (
            <button className="btn btn-accent" disabled={busy} onClick={onPlay} title="Play out today's game period by period">
              🏒 Play Today’s Game
            </button>
          )}
          <button className="btn btn-primary" disabled={busy} onClick={() => onSim(1)}>
            Sim Day
          </button>
          <button className="btn" disabled={busy} onClick={() => onSim(7)}>
            Sim Week
          </button>
          <button className="btn" disabled={busy} onClick={() => onSim(30)}>
            Sim Month
          </button>
          <button
            className="btn"
            disabled={busy || s.day >= DEADLINE_DAY}
            onClick={() => onSim(DEADLINE_DAY - s.day)}
            title="Trade deadline is day 120"
          >
            To Deadline
          </button>
          <button className="btn" disabled={busy} onClick={onSimEnd}>
            To Season End
          </button>
        </div>
      )}
    </div>
  )
}

/** Compact division standings window with the playoff cutline (top 3). */
function StandingsSnapshot({
  rows,
  userTeam,
  teams,
  onNavigate,
}: {
  rows: StandingsRow[]
  userTeam: string
  teams: GameState['teams']
  onNavigate: (t: TabKey) => void
}) {
  const userIdx = rows.findIndex((r) => r.team === userTeam)
  // Show a 4-row window that always includes the user; keep the top of the
  // table so the playoff cutline (after 3rd) reads as a reference line.
  let window: { row: StandingsRow; place: number }[]
  if (userIdx <= 3) {
    window = rows.slice(0, 4).map((row, i) => ({ row, place: i + 1 }))
  } else {
    window = [
      ...rows.slice(0, 3).map((row, i) => ({ row, place: i + 1 })),
      { row: rows[userIdx], place: userIdx + 1 },
    ]
  }
  return (
    <Card
      title="Division"
      right={
        <button className="btn btn-sm btn-ghost" onClick={() => onNavigate('standings')}>
          Full Table
        </button>
      }
    >
      <div className="table-wrap">
        <table className="tbl snapshot-tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th className="num">GP</th>
              <th className="num">PTS</th>
            </tr>
          </thead>
          <tbody>
            {window.map(({ row, place }) => {
              const t = teams[row.team]
              const cut = place === 3 // playoff line under 3rd
              return (
                <tr key={row.team} className={`${row.team === userTeam ? 'me' : ''} ${cut ? 'cutline' : ''}`}>
                  <td className="num muted">{place}</td>
                  <td>
                    <TeamLink abbrev={row.team} className="team-link-inline">
                      <TeamLogo team={t} size={18} />
                      <span>{t?.abbrev ?? row.team}</span>
                    </TeamLink>
                  </td>
                  <td className="num">{row.gp}</td>
                  <td className="num">{row.pts}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
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

function FormCard({ s, onOpenBox }: { s: GameState; onOpenBox: (g: Game) => void }) {
  const last10 = [...recentGames(s, s.userTeam, 10)].reverse() // most recent last
  const last5 = recentGames(s, s.userTeam, 5) // newest first
  if (last10.length === 0) {
    return (
      <Card title="Form">
        <div className="news-empty">No games played yet.</div>
      </Card>
    )
  }
  return (
    <Card title="Form — Last 10">
      <div className="card-pad" style={{ paddingBottom: 8 }}>
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
      <div className="form-recent-head">Recent Results</div>
      {last5.map((g) => {
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
      })}
    </Card>
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

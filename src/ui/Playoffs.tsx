import { useState } from 'react'
import type { GameState, PlayoffSeries, PlayoffGame, Game, SeasonStatLine } from '../types'
import { simPlayoffRound, simPlayoffGame, getPlayoffLeaders } from '../engine'
import { Card, TeamLogo, TeamLink, Crest, PlayerLink } from './components'
import { buildPlayerIndex } from './util'
import { fmtGaa, fmtSvPct } from './format'
import { BoxScoreModal } from './BoxScore'

const ROUND_NAME: Record<number, string> = {
  1: 'First Round',
  2: 'Second Round',
  3: 'Conference Finals',
  4: 'Stanley Cup Final',
}

/** Adapt a stored PlayoffGame to the Game shape the BoxScoreModal renders. */
function toGame(series: PlayoffSeries, pg: PlayoffGame, i: number): Game {
  const away = pg.home === series.high ? series.low : series.high
  return {
    id: series.round * 100000 + (series.high.charCodeAt(0) << 8) + i,
    day: 184 + i,
    home: pg.home,
    away,
    played: true,
    homeGoals: pg.homeGoals,
    awayGoals: pg.awayGoals,
    endType: pg.endType,
    goals: pg.goals,
  }
}

export function Playoffs({ s, apply, busy }: { s: GameState; apply: (n: GameState) => void; busy: boolean }) {
  const [boxGame, setBoxGame] = useState<Game | null>(null)
  const series = s.playoffs ?? []
  if (series.length === 0) {
    return (
      <Card title="Playoffs">
        <div className="news-empty">
          The bracket is set once the regular season ends. Sim to the end of the season to begin the playoffs.
        </div>
      </Card>
    )
  }

  const rounds = [1, 2, 3, 4].filter((r) => series.some((x) => x.round === r))
  const finalSeries = series.find((x) => x.round === 4)
  const champion = finalSeries?.winner
  const allDone = series.every((x) => x.winner)
  const activeRound = Math.max(...series.filter((x) => !x.winner).map((x) => x.round), 0)

  return (
    <div className="stack">
      {champion ? (
        <div className="banner playoffs">
          <div className="banner-body">
            <h4>🏆 {s.teams[champion]?.city} {s.teams[champion]?.name} win the Stanley Cup!</h4>
            <p>{champion === s.userTeam ? 'Your franchise are champions.' : 'Head to the offseason to keep building.'}</p>
          </div>
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => apply(simPlayoffRound(s))}>
            Continue to Offseason →
          </button>
        </div>
      ) : (
        <div className="banner playoffs">
          <div className="banner-body">
            <h4>{ROUND_NAME[activeRound] ?? 'Playoffs'}</h4>
            <p>Best-of-7 series. Sim game by game, or blitz the whole round.</p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-lg" disabled={busy || allDone} onClick={() => apply(simPlayoffGame(s))}>
              Sim Next Games
            </button>
            <button className="btn btn-lg" disabled={busy || allDone} onClick={() => apply(simPlayoffRound(s))}>
              Sim Round
            </button>
          </div>
        </div>
      )}

      <div className="bracket">
        {rounds.map((r) => (
          <div className="round-col" key={r}>
            <h4>{ROUND_NAME[r]}</h4>
            {series
              .filter((x) => x.round === r)
              .map((x, i) => (
                <SeriesCard key={`${r}-${i}`} series={x} s={s} onOpenGame={setBoxGame} />
              ))}
          </div>
        ))}
      </div>

      <PlayoffLeaders s={s} />

      {boxGame && <BoxScoreModal s={s} game={boxGame} onClose={() => setBoxGame(null)} />}
    </div>
  )
}

/** Postseason scoring + goaltending leaders, from the engine's playoff stat
 *  archive. User-team players are highlighted. Hidden until games are played. */
function PlayoffLeaders({ s }: { s: GameState }) {
  const leaders = getPlayoffLeaders(s)
  const idx = buildPlayerIndex(s)
  const points = leaders.points.slice(0, 10)
  const goalies = leaders.goalies.slice(0, 5)
  if (points.length === 0 && goalies.length === 0) return null

  function nameCell(line: SeasonStatLine) {
    const ref = idx.get(line.playerId)
    const team = ref?.team
    const t = team ? s.teams[team] : undefined
    return (
      <>
        <td className="name-cell">
          <PlayerLink id={line.playerId} player={ref?.player}>
            {ref?.player.name ?? line.playerId}
          </PlayerLink>
        </td>
        <td>
          {team ? (
            <TeamLink abbrev={team} className="team-link-inline">
              <Crest team={t} size="mini" />
              {team}
            </TeamLink>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      </>
    )
  }

  return (
    <div className="grid dash-grid">
      <Card title="Playoff Leaders · Scoring">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="num" style={{ width: 28 }}>#</th>
                <th>Player</th>
                <th>Team</th>
                <th className="num">GP</th>
                <th className="num">G</th>
                <th className="num">A</th>
                <th className="num">PTS</th>
              </tr>
            </thead>
            <tbody>
              {points.map((line, i) => (
                <tr key={line.playerId} className={idx.get(line.playerId)?.team === s.userTeam ? 'me' : ''}>
                  <td className="num muted">{i + 1}</td>
                  {nameCell(line)}
                  <td className="num">{line.gp}</td>
                  <td className="num">{line.goals}</td>
                  <td className="num">{line.assists}</td>
                  <td className="num" style={{ fontWeight: 800 }}>{line.points}</td>
                </tr>
              ))}
              {points.length === 0 && (
                <tr><td className="muted" colSpan={7} style={{ padding: 16 }}>No playoff scoring yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Playoff Leaders · Goaltending">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="num" style={{ width: 28 }}>#</th>
                <th>Player</th>
                <th>Team</th>
                <th className="num">GP</th>
                <th className="num">W</th>
                <th className="num m-hide">SO</th>
                <th className="num">GAA</th>
                <th className="num">SV%</th>
              </tr>
            </thead>
            <tbody>
              {goalies.map((line, i) => (
                <tr key={line.playerId} className={idx.get(line.playerId)?.team === s.userTeam ? 'me' : ''}>
                  <td className="num muted">{i + 1}</td>
                  {nameCell(line)}
                  <td className="num">{line.gp}</td>
                  <td className="num">{line.wins ?? 0}</td>
                  <td className="num m-hide">{line.shutouts ?? 0}</td>
                  <td className="num">{fmtGaa(line.gaa)}</td>
                  <td className="num">{fmtSvPct(line.svPct)}</td>
                </tr>
              ))}
              {goalies.length === 0 && (
                <tr><td className="muted" colSpan={8} style={{ padding: 16 }}>No playoff goaltending yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function SeriesCard({
  series,
  s,
  onOpenGame,
}: {
  series: PlayoffSeries
  s: GameState
  onOpenGame: (g: Game) => void
}) {
  const highT = s.teams[series.high]
  const lowT = s.teams[series.low]
  const highWon = series.winner === series.high
  const lowWon = series.winner === series.low
  const me = series.high === s.userTeam || series.low === s.userTeam
  const games = series.games ?? []
  return (
    <div className={`series ${me ? 'series-mine' : ''}`}>
      <div className={`series-team ${series.winner ? (highWon ? 'win' : 'lose') : ''} ${series.high === s.userTeam ? 'me-series' : ''}`}>
        <TeamLink abbrev={series.high} className="series-team-link">
          <TeamLogo
            team={highT}
            size={22}
            fallback={<span className="mini-crest" style={{ background: highT?.color ?? '#444' }}>{series.high}</span>}
          />
          <span>{highT ? highT.name : series.high}</span>
        </TeamLink>
        <span className="swins">{series.highWins}</span>
      </div>
      <div className={`series-team ${series.winner ? (lowWon ? 'win' : 'lose') : ''} ${series.low === s.userTeam ? 'me-series' : ''}`}>
        <TeamLink abbrev={series.low} className="series-team-link">
          <TeamLogo
            team={lowT}
            size={22}
            fallback={<span className="mini-crest" style={{ background: lowT?.color ?? '#444' }}>{series.low}</span>}
          />
          <span>{lowT ? lowT.name : series.low}</span>
        </TeamLink>
        <span className="swins">{series.lowWins}</span>
      </div>

      {games.length > 0 && (
        <div className="series-games">
          {games.map((g, i) => {
            const winner = g.homeGoals > g.awayGoals ? g.home : toGame(series, g, i).away
            const hi = Math.max(g.homeGoals, g.awayGoals)
            const lo = Math.min(g.homeGoals, g.awayGoals)
            return (
              <button
                key={i}
                type="button"
                className="series-game"
                title={`Game ${i + 1} · played at ${g.home} · view box score`}
                onClick={() => onOpenGame(toGame(series, g, i))}
              >
                <span className="sg-num">G{i + 1}</span>
                <span className="sg-win">{winner}</span>
                <span className="sg-score">{hi}–{lo}</span>
                {g.endType !== 'REG' && <span className="sg-ot">{g.endType}</span>}
                <span className="sg-home">@{g.home}</span>
              </button>
            )
          })}
        </div>
      )}

      {me && !series.winner && (
        <div className="series-mine-tag">Your series</div>
      )}
    </div>
  )
}

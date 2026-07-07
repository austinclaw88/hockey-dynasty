import { useState } from 'react'
import type { GameState, PlayoffSeries, PlayoffGame, Game } from '../types'
import { simPlayoffRound, simPlayoffGame } from '../engine'
import { Card, TeamLogo, TeamLink } from './components'
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

      {boxGame && <BoxScoreModal s={s} game={boxGame} onClose={() => setBoxGame(null)} />}
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

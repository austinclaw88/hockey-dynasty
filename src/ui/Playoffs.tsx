import type { GameState, PlayoffSeries } from '../types'
import { simPlayoffRound } from '../engine'
import { Card } from './components'

const ROUND_NAME: Record<number, string> = {
  1: 'First Round',
  2: 'Second Round',
  3: 'Conference Finals',
  4: 'Stanley Cup Final',
}

export function Playoffs({ s, apply, busy }: { s: GameState; apply: (n: GameState) => void; busy: boolean }) {
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
        </div>
      ) : (
        <div className="banner playoffs">
          <div className="banner-body">
            <h4>{ROUND_NAME[activeRound] ?? 'Playoffs'}</h4>
            <p>Best-of-7 series. Sim the round to advance the bracket.</p>
          </div>
          <button className="btn btn-primary btn-lg" disabled={busy || allDone} onClick={() => apply(simPlayoffRound(s))}>
            Sim Round
          </button>
        </div>
      )}

      <div className="bracket">
        {rounds.map((r) => (
          <div className="round-col" key={r}>
            <h4>{ROUND_NAME[r]}</h4>
            {series
              .filter((x) => x.round === r)
              .map((x, i) => (
                <SeriesCard key={`${r}-${i}`} series={x} s={s} />
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function SeriesCard({ series, s }: { series: PlayoffSeries; s: GameState }) {
  const highT = s.teams[series.high]
  const lowT = s.teams[series.low]
  const highWon = series.winner === series.high
  const lowWon = series.winner === series.low
  const me = series.high === s.userTeam || series.low === s.userTeam
  return (
    <div className="series">
      <div className={`series-team ${series.winner ? (highWon ? 'win' : 'lose') : ''} ${series.high === s.userTeam ? 'me-series' : ''}`}>
        <span className="mini-crest" style={{ background: highT?.color ?? '#444' }}>
          {series.high}
        </span>
        <span>{highT ? highT.name : series.high}</span>
        <span className="swins">{series.highWins}</span>
      </div>
      <div className={`series-team ${series.winner ? (lowWon ? 'win' : 'lose') : ''} ${series.low === s.userTeam ? 'me-series' : ''}`}>
        <span className="mini-crest" style={{ background: lowT?.color ?? '#444' }}>
          {series.low}
        </span>
        <span>{lowT ? lowT.name : series.low}</span>
        <span className="swins">{series.lowWins}</span>
      </div>
      {me && !series.winner && (
        <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--team2)', background: 'color-mix(in srgb, var(--team) 12%, transparent)' }}>
          Your series
        </div>
      )}
    </div>
  )
}

import { useMemo } from 'react'
import type { GameState, PlayoffSeries } from '../types'
import { getStandings, getPlayoffLeaders } from '../engine'
import { fmtRecord, seasonLabel } from './format'
import { buildPlayerIndex } from './util'

const ROUND_NAME: Record<number, string> = {
  1: 'First Round',
  2: 'Second Round',
  3: 'Conference Final',
  4: 'Stanley Cup Final',
}

interface RunLeg {
  round: number
  opponent: string
  userWins: number
  oppWins: number
}

/**
 * Full-screen Stanley Cup celebration for the user's franchise. Team-colored,
 * shows the season record, the round-by-round playoff run (from s.playoffs when
 * still present) and the team's top playoff scorer if derivable.
 */
export function Celebration({ s, seasonYear, onClose }: { s: GameState; seasonYear: number; onClose: () => void }) {
  const team = s.teams[s.userTeam]

  const record = useMemo(() => {
    const hist = s.history[s.history.length - 1]
    if (hist && hist.year === seasonYear && hist.cupWinner === s.userTeam) return hist.userRecord
    const row = getStandings(s).league.find((r) => r.team === s.userTeam)
    return row ? { w: row.w, l: row.l, otl: row.otl, pts: row.pts } : null
  }, [s, seasonYear])

  const run = useMemo<RunLeg[]>(() => {
    const series = (s.playoffs ?? []).filter((x) => x.high === s.userTeam || x.low === s.userTeam)
    return series
      .sort((a, b) => a.round - b.round)
      .map((x: PlayoffSeries) => {
        const isHigh = x.high === s.userTeam
        return {
          round: x.round,
          opponent: isHigh ? x.low : x.high,
          userWins: isHigh ? x.highWins : x.lowWins,
          oppWins: isHigh ? x.lowWins : x.highWins,
        }
      })
  }, [s])

  const topScorer = useMemo(() => {
    // Use the engine's playoff scoring archive — more accurate than re-deriving
    // from box scores, and consistent with the Playoff Leaders card.
    const idx = buildPlayerIndex(s)
    const leaders = getPlayoffLeaders(s)
    const mine = leaders.points.find((l) => idx.get(l.playerId)?.team === s.userTeam)
    if (!mine || mine.points === 0) return null
    return { name: idx.get(mine.playerId)?.player.name ?? 'Unknown', points: mine.points }
  }, [s])

  const rootStyle = {
    ['--cup1' as string]: team.color || '#2a6cff',
    ['--cup2' as string]: team.colorSecondary || '#ffffff',
  } as React.CSSProperties

  return (
    <div className="cup-overlay" style={rootStyle} role="dialog" aria-modal="true" aria-label="Stanley Cup champions">
      <div className="cup-card">
        <div className="cup-trophy" aria-hidden>🏆</div>
        <div className="cup-kicker">{seasonLabel(seasonYear)} · Stanley Cup Champions</div>
        <h1 className="cup-title">
          THE {(team.city ?? '').toUpperCase()} {(team.name ?? '').toUpperCase()} HAVE WON THE STANLEY CUP
        </h1>

        {record && (
          <div className="cup-record">
            Regular season <strong>{fmtRecord(record.w, record.l, record.otl)}</strong> · {record.pts} pts
          </div>
        )}

        {run.length > 0 && (
          <div className="cup-run">
            <div className="cup-run-head">Road to the Cup</div>
            {run.map((leg) => (
              <div className="cup-run-leg" key={leg.round}>
                <span className="cup-run-round">{ROUND_NAME[leg.round] ?? `Round ${leg.round}`}</span>
                <span className="cup-run-opp">
                  def. {s.teams[leg.opponent]?.name ?? leg.opponent}
                </span>
                <span className="cup-run-score">
                  {leg.userWins}–{leg.oppWins}
                </span>
              </div>
            ))}
          </div>
        )}

        {topScorer && (
          <div className="cup-scorer">
            Playoff scoring leader: <strong>{topScorer.name}</strong> · {topScorer.points} pts
          </div>
        )}

        <button className="btn btn-primary btn-lg cup-continue" onClick={onClose}>
          Continue
        </button>
      </div>
    </div>
  )
}

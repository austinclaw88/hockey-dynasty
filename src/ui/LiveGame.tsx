import { useMemo, useState } from 'react'
import type { GameState, Game } from '../types'
import { Modal, TeamLogo } from './components'
import { GoalLine } from './BoxScore'
import { buildPlayerIndex, resolveGoals, scoreThroughPeriod, PERIOD_LABEL, dayLabel } from './util'

/**
 * Progressive period-by-period reveal of the user's game result. The sim has
 * already run (game is played); this just unveils the goals period by period
 * for drama. Skippable to the final at any time.
 */
export function LiveGameModal({ s, game, onClose }: { s: GameState; game: Game; onClose: () => void }) {
  const idx = useMemo(() => buildPlayerIndex(s), [s])
  const goals = useMemo(() => resolveGoals(game, idx), [game, idx])
  const home = s.teams[game.home]
  const away = s.teams[game.away]
  const hg = game.homeGoals ?? 0
  const ag = game.awayGoals ?? 0
  const endTag = game.endType && game.endType !== 'REG' ? game.endType : null
  const isSO = game.endType === 'SO'
  const lastOrder = goals.length > 0 ? goals[goals.length - 1].order : -1

  // Which periods to walk through: always 1-3, plus OT if it went there.
  const anyPeriod = goals.some((g) => g.period != null)
  const hasOT = goals.some((g) => g.period === 4) || game.endType === 'OT' || game.endType === 'SO'
  const periods = anyPeriod ? (hasOT ? [1, 2, 3, 4] : [1, 2, 3]) : []

  // stage 0 = pre-game; stage k reveals periods[0..k-1]; final = periods.length + 1
  const finalStage = periods.length + 1
  // Legacy games (no period data) jump straight to final.
  const [stage, setStage] = useState(anyPeriod ? 0 : finalStage)

  const revealedPeriods = periods.slice(0, Math.min(stage, periods.length))
  const atFinal = stage >= finalStage
  const shownThrough = atFinal ? 99 : revealedPeriods.length > 0 ? revealedPeriods[revealedPeriods.length - 1] : 0
  const [sa, sh] = atFinal ? [ag, hg] : scoreThroughPeriod(goals, game.away, game.home, shownThrough)

  const nextPeriod = periods[stage] // when stage < periods.length, the period we're about to start
  const nextLabel =
    stage < periods.length
      ? nextPeriod === 4
        ? 'Start Overtime'
        : `Start ${PERIOD_LABEL[nextPeriod]}`
      : 'See Final'

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">
          <h3>Game Day</h3>
          <div className="meta">{dayLabel(game.day)}</div>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="modal-body">
        <div className="live-score">
          <div className="live-team">
            <TeamLogo team={away} size={40} />
            <span className="live-team-name">{away?.name ?? game.away}</span>
          </div>
          <div className="live-score-nums">
            <span className="num">{sa}</span>
            <span className="live-dash">–</span>
            <span className="num">{sh}</span>
          </div>
          <div className="live-team">
            <TeamLogo team={home} size={40} />
            <span className="live-team-name">{home?.name ?? game.home}</span>
          </div>
        </div>

        {stage === 0 ? (
          <div className="live-intro hint">Puck drop. Reveal the game period by period.</div>
        ) : (
          <div className="box-periods">
            {revealedPeriods.map((p) => {
              const pg = goals.filter((g) => g.period === p)
              return (
                <div className="box-period" key={p}>
                  <div className="period-head">{PERIOD_LABEL[p]}</div>
                  {pg.length === 0 ? (
                    <div className="hint period-empty">No scoring.</div>
                  ) : (
                    <div className="box-goals">
                      {pg.map((g) => (
                        <GoalLine key={g.order} g={g} so={isSO && g.order === lastOrder} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {/* Any legacy no-period goals surface at the final stage. */}
            {atFinal && !anyPeriod && (
              <div className="box-goals">
                {goals.map((g) => (
                  <GoalLine key={g.order} g={g} so={isSO && g.order === lastOrder} />
                ))}
              </div>
            )}
          </div>
        )}

        {atFinal && (
          <div className="live-final">
            <span className="box-final">FINAL{endTag ? `/${endTag}` : ''}</span>
          </div>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          {!atFinal ? (
            <>
              <button className="btn btn-primary btn-lg" onClick={() => setStage((k) => k + 1)}>
                {nextLabel}
              </button>
              <div className="spacer" />
              <button className="btn btn-ghost" onClick={() => setStage(finalStage)}>
                Skip to final
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

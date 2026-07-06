import { useMemo } from 'react'
import type { GameState, Game } from '../types'
import { Modal, TeamLogo, PlayerLink } from './components'
import { buildPlayerIndex, dayLabel, resolveGoals, groupGoalsByPeriod, PERIOD_LABEL } from './util'
import type { ResolvedGoal } from './util'

/** Box score modal for a played game: final score header + goal-by-goal lines. */
export function BoxScoreModal({ s, game, onClose }: { s: GameState; game: Game; onClose: () => void }) {
  const idx = useMemo(() => buildPlayerIndex(s), [s])
  const goals = useMemo(() => resolveGoals(game, idx), [game, idx])
  const groups = useMemo(() => groupGoalsByPeriod(goals), [goals])
  const home = s.teams[game.home]
  const away = s.teams[game.away]
  const hg = game.homeGoals ?? 0
  const ag = game.awayGoals ?? 0
  const endTag = game.endType && game.endType !== 'REG' ? game.endType : null
  const isSO = game.endType === 'SO'
  const lastOrder = goals.length > 0 ? goals[goals.length - 1].order : -1

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">
          <h3>Box Score</h3>
          <div className="meta">{dayLabel(game.day)}</div>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="modal-body">
        <div className="box-score-head">
          <BoxTeam team={away} abbrev={game.away} goals={ag} win={ag > hg} />
          <div className="box-score-sep">
            <span className="box-final">FINAL{endTag ? `/${endTag}` : ''}</span>
          </div>
          <BoxTeam team={home} abbrev={game.home} goals={hg} win={hg > ag} />
        </div>

        <div className="mini-title" style={{ marginTop: 16 }}>
          Scoring{endTag ? ` · ${endTag === 'SO' ? 'Shootout' : 'Overtime'}` : ''}
        </div>
        {goals.length === 0 ? (
          <div className="hint">No goal-by-goal detail recorded for this game.</div>
        ) : (
          <div className="box-periods">
            {groups.map((grp) => (
              <div className="box-period" key={grp.period ?? 'none'}>
                {grp.period !== null && <div className="period-head">{PERIOD_LABEL[grp.period] ?? `Period ${grp.period}`}</div>}
                {grp.goals.length === 0 ? (
                  <div className="hint period-empty">No scoring.</div>
                ) : (
                  <div className="box-goals">
                    {grp.goals.map((g) => (
                      <GoalLine key={g.order} g={g} so={isSO && g.order === lastOrder} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** One scoring line: team tag, clickable scorer + clickable assists. */
export function GoalLine({ g, so }: { g: ResolvedGoal; so?: boolean }) {
  return (
    <div className="box-goal">
      <span className="box-goal-team">{g.team}</span>
      <span className="box-goal-text">
        <PlayerLink id={g.scorerId} className="box-scorer">
          {g.scorerName}
        </PlayerLink>
        {g.assists.length > 0 && (
          <span className="muted">
            {' ('}
            {g.assists.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ', '}
                <PlayerLink id={a.id} className="box-assist">
                  {a.name}
                </PlayerLink>
              </span>
            ))}
            {')'}
          </span>
        )}
        {so && <span className="tag" style={{ marginLeft: 8 }}>SO</span>}
      </span>
    </div>
  )
}

function BoxTeam({
  team,
  abbrev,
  goals,
  win,
}: {
  team: GameState['teams'][string] | undefined
  abbrev: string
  goals: number
  win: boolean
}) {
  return (
    <div className={`box-team ${win ? 'win' : ''}`}>
      <TeamLogo team={team} size={34} />
      <span className="box-team-name">{team?.name ?? abbrev}</span>
      <span className="box-team-goals num">{goals}</span>
    </div>
  )
}

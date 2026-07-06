import { useMemo } from 'react'
import type { GameState, Game } from '../types'
import { Modal, TeamLogo } from './components'
import { buildPlayerIndex, boxScoreLines, dayLabel } from './util'

/** Box score modal for a played game: final score header + goal-by-goal lines. */
export function BoxScoreModal({ s, game, onClose }: { s: GameState; game: Game; onClose: () => void }) {
  const idx = useMemo(() => buildPlayerIndex(s), [s])
  const lines = useMemo(() => boxScoreLines(s, game, idx), [s, game, idx])
  const home = s.teams[game.home]
  const away = s.teams[game.away]
  const hg = game.homeGoals ?? 0
  const ag = game.awayGoals ?? 0
  const endTag = game.endType && game.endType !== 'REG' ? game.endType : null

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
        {lines.length === 0 ? (
          <div className="hint">No goal-by-goal detail recorded for this game.</div>
        ) : (
          <div className="box-goals">
            {lines.map((ln, i) => (
              <div className="box-goal" key={i}>
                <span className="box-goal-team">{ln.team}</span>
                <span className="box-goal-text">
                  <strong>{ln.scorer}</strong>
                  {ln.assists.length > 0 && <span className="muted"> ({ln.assists.join(', ')})</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
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

import type { GameState, StandingsRow } from '../types'
import { seasonLabel, fmtRecord } from './format'
import { TeamLogo } from './components'

const PHASE_LABEL: Record<GameState['phase'], string> = {
  fantasyDraft: 'Fantasy Draft',
  regular: 'Regular Season',
  playoffs: 'Playoffs',
  offseason: 'Offseason',
  over: 'Dynasty Complete',
}

export function Header({ s, userRow }: { s: GameState; userRow?: StandingsRow }) {
  const team = s.teams[s.userTeam]
  const phaseText =
    s.phase === 'offseason' && s.offseasonStep
      ? `Offseason · ${stepLabel(s.offseasonStep)}`
      : PHASE_LABEL[s.phase]

  return (
    <header className="header">
      <div className="header-inner">
        <TeamLogo team={team} size={46} fallback={<span className="header-crest">{team.abbrev}</span>} />
        <div className="header-titles">
          <div className="header-team">
            <span className="header-abbrev">{team.abbrev}</span>
            <span className="header-fullname">
              {team.city} {team.name}
            </span>
          </div>
          <div className="header-sub">
            <span>{seasonLabel(s.seasonYear)}</span>
            <span className="dot">·</span>
            <span className="pill">{phaseText}</span>
            <span className="dot">·</span>
            <span>Season {s.seasonIndex + 1} of 10</span>
          </div>
        </div>
        {userRow && (
          <div className="header-record">
            <div className="big">{fmtRecord(userRow.w, userRow.l, userRow.otl)}</div>
            <div className="small">{userRow.pts} pts · {userRow.gp} GP</div>
          </div>
        )}
      </div>
    </header>
  )
}

function stepLabel(step: NonNullable<GameState['offseasonStep']>): string {
  const map: Record<NonNullable<GameState['offseasonStep']>, string> = {
    awards: 'Awards',
    development: 'Development',
    resign: 'Re-Signings',
    draft: 'Draft',
    freeAgency: 'Free Agency',
    rosterCheck: 'Roster Check',
  }
  return map[step]
}

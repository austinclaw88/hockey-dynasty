import type { ReactNode } from 'react'
import type { GameState, StandingsRow } from '../types'
import type { TabDef, TabKey } from './TabNav'
import { TeamLogo } from './components'
import { fmtRecord } from './format'

const PHASE_SHORT: Record<GameState['phase'], string> = {
  fantasyDraft: 'Draft',
  regular: 'Regular',
  playoffs: 'Playoffs',
  offseason: 'Offseason',
  over: 'Complete',
}

/** Minimal stroke icons keyed by tab. Inline so nothing hits the network. */
function tabIcon(key: TabKey): ReactNode {
  const p = (d: string) => <path d={d} />
  switch (key) {
    case 'dashboard':
      return <svg viewBox="0 0 24 24">{p('M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z')}</svg>
    case 'roster':
      return (
        <svg viewBox="0 0 24 24">
          {p('M4 6h16M4 12h16M4 18h16')}
          <circle cx="4" cy="6" r="0.6" />
        </svg>
      )
    case 'players':
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="3.4" />
          {p('M5 20a7 7 0 0 1 14 0')}
        </svg>
      )
    case 'standings':
      return <svg viewBox="0 0 24 24">{p('M5 21V10M12 21V4M19 21v-7')}</svg>
    case 'leaders':
      return (
        <svg viewBox="0 0 24 24">
          {p('M7 4h10v4a5 5 0 0 1-10 0zM9 14h6M8 20h8M12 13v3')}
        </svg>
      )
    case 'trades':
      return <svg viewBox="0 0 24 24">{p('M7 7h11l-3-3M17 17H6l3 3')}</svg>
    case 'playoffs':
      return <svg viewBox="0 0 24 24">{p('M6 4v6l6 4 6-4V4M12 14v6M8 20h8')}</svg>
    case 'offseason':
      return (
        <svg viewBox="0 0 24 24">
          {p('M4 6h16v14H4zM4 10h16M8 3v4M16 3v4')}
        </svg>
      )
    case 'history':
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8.5" />
          {p('M12 7v5l3 2')}
        </svg>
      )
    default:
      return <svg viewBox="0 0 24 24">{p('M4 4h16v16H4z')}</svg>
  }
}

/**
 * Desktop-only fixed left rail: crest, vertical icon+label nav, and a
 * season/phase footer chip. Hidden below 1000px, where the top Header + TabNav
 * take over (see styles.css). Shares tabs/active/onChange with TabNav so the
 * two navs stay in lockstep.
 */
export function Rail({
  s,
  userRow,
  tabs,
  active,
  onChange,
}: {
  s: GameState
  userRow?: StandingsRow
  tabs: TabDef[]
  active: TabKey
  onChange: (t: TabKey) => void
}) {
  const team = s.teams[s.userTeam]
  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-crest" title={`${team.city} ${team.name}`}>
        <TeamLogo team={team} size={40} fallback={<span className="rail-mono">{team.abbrev}</span>} />
        <span className="rail-abbrev">{team.abbrev}</span>
      </div>

      <div className="rail-nav">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`rail-tab ${active === t.key ? 'active' : ''}`}
            onClick={() => onChange(t.key)}
            title={t.label}
          >
            <span className="rail-ico">{tabIcon(t.key)}</span>
            <span className="rail-label">{t.label}</span>
            {t.badge && <span className="rail-badge">{t.badge}</span>}
          </button>
        ))}
      </div>

      <div className="rail-foot">
        {userRow && (
          <div className="rail-record">{fmtRecord(userRow.w, userRow.l, userRow.otl)}</div>
        )}
        <div className="rail-phase">{PHASE_SHORT[s.phase]}</div>
        <div className="rail-season">
          S{s.seasonIndex + 1}<span className="rail-season-of">/10</span>
        </div>
      </div>
    </nav>
  )
}

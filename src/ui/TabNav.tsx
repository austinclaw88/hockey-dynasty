export type TabKey =
  | 'dashboard'
  | 'roster'
  | 'players'
  | 'standings'
  | 'leaders'
  | 'teamStats'
  | 'trades'
  | 'playoffs'
  | 'offseason'
  | 'history'

export interface TabDef {
  key: TabKey
  label: string
  badge?: string
}

export function TabNav({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[]
  active: TabKey
  onChange: (t: TabKey) => void
}) {
  return (
    <nav className="tabs">
      <div className="tabs-inner">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab ${active === t.key ? 'active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            {t.label}
            {t.badge && <span className="badge">{t.badge}</span>}
          </button>
        ))}
      </div>
    </nav>
  )
}

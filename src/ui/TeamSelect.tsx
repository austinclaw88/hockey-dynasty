import { useMemo, useState } from 'react'
import { TEAM_DATA } from '../data'
import type { TeamDataFile } from '../types'
import { teamOverall, rosterCapHit } from './util'
import { fmtM } from './format'
import { DIVISIONS } from './util'
import { TeamLogo } from './components'

export type GameMode = 'standard' | 'fantasy'

export function TeamSelect({
  onSelect,
  onContinue,
  hasSave,
}: {
  onSelect: (abbrev: string, mode: GameMode) => void
  onContinue: () => void
  hasSave: boolean
}) {
  const [mode, setMode] = useState<GameMode>('standard')
  const cards = useMemo(() => {
    return [...TEAM_DATA]
      .map((t) => ({
        file: t,
        ovr: teamOverall(t.roster),
        cap: rosterCapHit(t.roster),
      }))
      .sort((a, b) => a.file.info.city.localeCompare(b.file.info.city))
  }, [])

  return (
    <div className="teamselect">
      <div className="ts-hero">
        <h1>Hockey Dynasty</h1>
        <p>Pick a franchise and run it for 10 seasons — trades, the draft, free agency, the works.</p>
        {hasSave && (
          <div className="ts-continue">
            <button className="btn btn-primary btn-lg" onClick={onContinue}>
              ▸ Continue Save
            </button>
          </div>
        )}

        <div className="ts-mode">
          <div className="ts-mode-toggle" role="tablist" aria-label="Game mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'standard'}
              className={`ts-mode-btn ${mode === 'standard' ? 'active' : ''}`}
              onClick={() => setMode('standard')}
            >
              Standard
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'fantasy'}
              className={`ts-mode-btn ${mode === 'fantasy' ? 'active' : ''}`}
              onClick={() => setMode('fantasy')}
            >
              Fantasy Draft
            </button>
          </div>
          <p className="ts-mode-note">
            {mode === 'standard'
              ? 'Take over your franchise as it stands today and run it for 10 seasons.'
              : 'Every NHL player enters one big draft — you draft your whole roster from scratch, then play it out.'}
          </p>
        </div>
      </div>

      {DIVISIONS.map((div) => {
        const inDiv = cards.filter((c) => c.file.info.division === div)
        if (inDiv.length === 0) return null
        return (
          <div key={div} style={{ marginBottom: 24 }}>
            <div className="ts-div">{div}</div>
            <div className="team-grid">
              {inDiv.map((c) => (
                <TeamCard
                  key={c.file.info.abbrev}
                  data={c.file}
                  ovr={c.ovr}
                  cap={c.cap}
                  onSelect={(abbrev) => onSelect(abbrev, mode)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TeamCard({
  data,
  ovr,
  cap,
  onSelect,
}: {
  data: TeamDataFile
  ovr: number
  cap: number
  onSelect: (abbrev: string) => void
}) {
  const { info } = data
  return (
    <button
      className="team-card"
      style={{ ['--tc' as string]: info.color }}
      onClick={() => onSelect(info.abbrev)}
    >
      <div className="tc-top">
        <TeamLogo
          team={info}
          size={38}
          fallback={
            <span className="crest" style={{ background: info.color }}>
              {info.abbrev}
            </span>
          }
        />
        <div className="tc-name">
          <div className="tc-city">{info.city}</div>
          <div className="tc-team">{info.name}</div>
        </div>
      </div>
      <div className="tc-stats">
        <div>
          <div className="k">Overall</div>
          <div className="v">{ovr.toFixed(1)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="k">Cap Used</div>
          <div className="v">{fmtM(cap)}</div>
        </div>
      </div>
    </button>
  )
}

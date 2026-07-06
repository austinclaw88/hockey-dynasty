import { useMemo } from 'react'
import { TEAM_DATA } from '../data'
import type { TeamDataFile } from '../types'
import { teamOverall, rosterCapHit } from './util'
import { fmtM } from './format'
import { DIVISIONS } from './util'

export function TeamSelect({
  onSelect,
  onContinue,
  hasSave,
}: {
  onSelect: (abbrev: string) => void
  onContinue: () => void
  hasSave: boolean
}) {
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
      </div>

      {DIVISIONS.map((div) => {
        const inDiv = cards.filter((c) => c.file.info.division === div)
        if (inDiv.length === 0) return null
        return (
          <div key={div} style={{ marginBottom: 24 }}>
            <div className="section-sub" style={{ marginBottom: 8, fontWeight: 700 }}>
              {div}
            </div>
            <div className="team-grid">
              {inDiv.map((c) => (
                <TeamCard key={c.file.info.abbrev} data={c.file} ovr={c.ovr} cap={c.cap} onSelect={onSelect} />
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
        <span className="crest" style={{ background: info.color }}>
          {info.abbrev}
        </span>
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

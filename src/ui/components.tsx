// Small reusable presentational components.
import type { ReactNode } from 'react'
import type { Player, TeamState } from '../types'
import { ovrClass } from './format'
import { capZone } from './util'

/** Colored circular team crest with abbreviation. */
export function Crest({
  team,
  size = 'md',
}: {
  team: { abbrev: string; color: string; colorSecondary?: string } | undefined
  size?: 'sm' | 'md' | 'mini'
}) {
  const cls = size === 'mini' ? 'mini-crest' : size === 'sm' ? 'crest' : 'crest'
  const color = team?.color ?? '#444'
  return (
    <span className={cls} style={{ background: color }}>
      {team?.abbrev ?? '?'}
    </span>
  )
}

export function OvrBadge({ overall }: { overall: number }) {
  return <span className={ovrClass(overall)}>{overall}</span>
}

export function PosTag({ pos }: { pos: string }) {
  return <span className="pos-tag">{pos}</span>
}

export function Flag({ nat }: { nat?: string }) {
  if (!nat) return null
  return <span className="flag">{nat}</span>
}

export function ExpiryTag({ expiry }: { expiry: 'RFA' | 'UFA' }) {
  return <span className={`tag ${expiry.toLowerCase()}`}>{expiry}</span>
}

export function CapBar({ used, cap }: { used: number; cap: number }) {
  const zone = capZone(used, cap)
  const pct = Math.min(100, (used / cap) * 100)
  const space = Math.round((cap - used) * 100) / 100
  return (
    <div>
      <div className={`capbar ${zone}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="cap-legend">
        <span>
          ${used.toFixed(2)}M <span className="muted">/ ${cap.toFixed(1)}M</span>
        </span>
        <span className={`cap-space ${space >= 0 ? 'pos' : 'neg'}`}>
          {space >= 0 ? `$${space.toFixed(2)}M space` : `$${Math.abs(space).toFixed(2)}M over`}
        </span>
      </div>
    </div>
  )
}

export function Modal({
  onClose,
  children,
}: {
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function Card({
  title,
  right,
  children,
  pad,
}: {
  title?: string
  right?: ReactNode
  children: ReactNode
  pad?: boolean
}) {
  return (
    <div className="card">
      {title && (
        <div className="card-head">
          <h3>{title}</h3>
          {right}
        </div>
      )}
      <div className={pad ? 'card-pad' : undefined}>{children}</div>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

/** Colored border card used on the team-select screen. */
export function teamStyleVars(team: TeamState | { color: string; colorSecondary?: string }): {
  ['--team']: string
  ['--team2']: string
} {
  return {
    ['--team']: team.color || '#2a6cff',
    ['--team2']: team.colorSecondary || '#ffffff',
  } as { ['--team']: string; ['--team2']: string }
}

export function playerContractSummary(p: Player): string {
  if (!p.contract) return 'Unsigned'
  const { capHit, yearsLeft, expiry } = p.contract
  return `$${capHit}M · ${yearsLeft}yr · ${expiry}`
}

// Small reusable presentational components.
import { useEffect, useState, type ReactNode } from 'react'
import type { Player, TeamState } from '../types'
import { ovrClass, seasonLabel } from './format'
import { capZone } from './util'
import { useUI, type Toast } from './uiContext'

/**
 * Real NHL team logo (light variant, for dark backgrounds). External images
 * are blocked in the sandboxed/published build, so `onError` cleanly hides the
 * broken image and swaps in a colored-circle abbrev monogram — same footprint,
 * no layout shift. Pass `fallback` to reuse a context-specific monogram
 * (e.g. the header / team-card crests); otherwise a generic circle is drawn.
 */
export function TeamLogo({
  team,
  size = 22,
  fallback,
}: {
  team: { abbrev: string; color: string; colorSecondary?: string } | undefined
  size?: number
  fallback?: ReactNode
}) {
  const [failed, setFailed] = useState(false)
  const abbrev = team?.abbrev
  if (!abbrev || failed) {
    if (fallback !== undefined) return <>{fallback}</>
    return (
      <span
        className="team-logo-fallback"
        style={{
          width: size,
          height: size,
          background: team?.color ?? '#444',
          fontSize: Math.max(8, Math.round(size * 0.3)),
        }}
      >
        {abbrev ?? '?'}
      </span>
    )
  }
  return (
    <img
      className="team-logo"
      src={`https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg`}
      alt={abbrev}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  )
}

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

/**
 * Cap bar. Always driven by the engine's getCapUsage result so the number is
 * identical on every screen. `capYear` labels WHICH season's cap the usage is
 * measured against ("· 2027-28 cap") — during the offseason that's next season,
 * which is what new contracts count against. `note` shows optional subtext.
 */
export function CapBar({
  used,
  cap,
  capYear,
  note,
}: {
  used: number
  cap: number
  capYear?: number
  note?: ReactNode
}) {
  const zone = capZone(used, cap)
  const pct = Math.min(100, (used / cap) * 100)
  const space = Math.round((cap - used) * 100) / 100
  return (
    <div>
      <div className={`capbar ${zone}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="cap-legend">
        <span className="num">
          ${used.toFixed(2)}M <span className="muted">/ ${cap.toFixed(1)}M</span>
          {capYear !== undefined && <span className="muted"> · {seasonLabel(capYear)} cap</span>}
        </span>
        <span className={`cap-space ${space >= 0 ? 'pos' : 'neg'}`}>
          {space >= 0 ? `$${space.toFixed(2)}M space` : `$${Math.abs(space).toFixed(2)}M over`}
        </span>
      </div>
      {note && <div className="cap-note">{note}</div>}
    </div>
  )
}

/** A clickable wrapper that opens the read-only team viewer for `abbrev`. */
export function TeamLink({
  abbrev,
  className,
  title,
  children,
}: {
  abbrev: string | undefined
  className?: string
  title?: string
  children: ReactNode
}) {
  const { openTeam } = useUI()
  if (!abbrev) return <>{children}</>
  return (
    <button
      type="button"
      className={`team-link ${className ?? ''}`}
      title={title ?? `View ${abbrev}`}
      onClick={(e) => {
        e.stopPropagation()
        openTeam(abbrev)
      }}
    >
      {children}
    </button>
  )
}

/**
 * Clickable player name that opens the shared PlayerModal (with Career table)
 * from anywhere. Pass a Player object (preferred — avoids a lookup) or an id.
 * Stops propagation so it works inside clickable rows without triggering the
 * row's own handler.
 */
export function PlayerLink({
  id,
  player,
  team,
  className,
  title,
  children,
}: {
  id?: string
  player?: Player
  team?: string
  className?: string
  title?: string
  children: ReactNode
}) {
  const { openPlayer } = useUI()
  const target = player ?? id
  if (target === undefined) return <>{children}</>
  return (
    <button
      type="button"
      className={`player-link ${className ?? ''}`}
      title={title ?? 'View player card'}
      onClick={(e) => {
        e.stopPropagation()
        openPlayer(target, team)
      }}
    >
      {children}
    </button>
  )
}

/** Small "on the block" chip badge. */
export function ShopBadge() {
  return (
    <span className="shop-badge" title="On the trade block">
      SHOP
    </span>
  )
}

/** Bottom-right auto-dismissing toast stack (rendered once at App level). */
export function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="toast-viewport" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast ${t.kind}`} onClick={() => onDismiss(t.id)}>
          <span className="toast-icon">{t.kind === 'success' ? '✓' : '!'}</span>
          <span className="toast-text">{t.text}</span>
        </button>
      ))}
    </div>
  )
}

export function Modal({
  onClose,
  children,
  wide,
}: {
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
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

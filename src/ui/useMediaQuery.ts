import { useEffect, useState } from 'react'

/**
 * Reactive CSS media-query hook. Used sparingly where the mobile layout must
 * change structurally (not just visually) — e.g. collapsible trade columns.
 */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = () => setMatch(mql.matches)
    handler()
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])
  return match
}

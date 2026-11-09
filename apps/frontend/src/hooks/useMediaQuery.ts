import { useEffect, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — hooks média (breakpoints Tailwind)
//
// Utilisé là où le CSS ne suffit pas : le rendu R3F (drei <Html>, cadrage
// caméra) doit changer de stratégie, pas seulement de style.
// ─────────────────────────────────────────────────────────────────────────────

export const DESKTOP_MEDIA_QUERY = '(min-width: 768px)'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)

    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** `true` à partir du breakpoint `md` (768 px) — aligné sur Tailwind. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_MEDIA_QUERY)
}
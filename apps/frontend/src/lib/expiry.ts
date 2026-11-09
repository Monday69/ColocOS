// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Statut de péremption (helper partagé UI + 3D)
//
// Source de vérité des seuils : le backend (HEALTH_THRESHOLDS dans
// apps/backend/src/types/digitalTwin.ts) colore les zones, et `HealthLegend`
// affiche ces mêmes seuils. On les réplique ici pour que le halo d'un
// packaging ne contredise jamais la couleur de sa clayette.
//
//   CRITICAL : périmé ou ≤ 2 jours restants
//   WARNING  : 3 à 7 jours restants
//   FRESH    : > 7 jours restants
//   NONE     : aucune date renseignée
// ─────────────────────────────────────────────────────────────────────────────

export type ExpiryStatus = 'CRITICAL' | 'WARNING' | 'FRESH' | 'NONE'

export const EXPIRY_THRESHOLDS = {
  /** DLC dans ≤ 2 jours (ou déjà dépassée) → rouge */
  CRITICAL_DAYS: 2,
  /** DLC dans ≤ 7 jours → ambre */
  WARNING_DAYS: 7,
} as const

/** Couleurs d'alerte (alignées sur la palette Tailwind du design system). */
export const EXPIRY_COLORS = {
  critical: '#ef4444',
  warning: '#f59e0b',
  /** Repli quand l'item n'a pas de propriétaire coloré */
  fresh: '#38bdf8',
} as const

const MS_PER_DAY = 86_400_000

interface DayParts {
  year: number
  month: number
  day: number
}

/**
 * Extrait les composantes calendaires locales d'une date.
 * `'YYYY-MM-DD'` est lu comme une date **locale** : `new Date('2026-11-10')`
 * serait interprété en UTC et décalerait le statut d'un jour selon le fuseau.
 */
function toDayParts(input: string | Date): DayParts | null {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null
    return {
      year: input.getFullYear(),
      month: input.getMonth(),
      day: input.getDate(),
    }
  }

  const raw = input.trim()
  if (raw === '') return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]) - 1, day: Number(iso[3]) }
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth(),
    day: parsed.getDate(),
  }
}

/**
 * Nombre de jours pleins entre `input` et aujourd'hui **à minuit**.
 * Négatif si la date est passée, `null` si elle est absente ou invalide.
 */
export function daysUntilExpiry(
  input: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (input === null || input === undefined) return null

  const target = toDayParts(input)
  if (!target) return null

  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  // Date.UTC neutralise les changements d'heure (23 h / 25 h dans une journée)
  const then = Date.UTC(target.year, target.month, target.day)
  return Math.round((then - today) / MS_PER_DAY)
}

/** Statut déduit d'un nombre de jours déjà calculé (ex. `item.daysUntilExpiry`). */
export function getExpiryStatusFromDays(days: number | null | undefined): ExpiryStatus {
  if (days === null || days === undefined || !Number.isFinite(days)) return 'NONE'
  if (days <= EXPIRY_THRESHOLDS.CRITICAL_DAYS) return 'CRITICAL'
  if (days <= EXPIRY_THRESHOLDS.WARNING_DAYS) return 'WARNING'
  return 'FRESH'
}

/**
 * Statut de péremption d'une date (`'YYYY-MM-DD'`, ISO complète ou `Date`).
 * C'est le point d'entrée demandé par l'UI comme par la scène 3D.
 */
export function getExpiryStatus(
  input: string | Date | null | undefined,
  now: Date = new Date(),
): ExpiryStatus {
  return getExpiryStatusFromDays(daysUntilExpiry(input, now))
}

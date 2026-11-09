import type { FridgeStateTwin, ZoneItemTwin } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — sélecteurs du Digital Twin
//
// L'état `/fridge/state` est indexé par meshId ; ces helpers retrouvent un item
// (et sa clayette) à partir de son seul identifiant, sans requête réseau.
// ─────────────────────────────────────────────────────────────────────────────

export function findItem(
  state: FridgeStateTwin | null | undefined,
  itemId: string | null | undefined,
): ZoneItemTwin | null {
  if (!state || !itemId) return null
  for (const zone of Object.values(state.zones)) {
    const found = zone.items.find((item) => item.id === itemId)
    if (found) return found
  }
  return null
}
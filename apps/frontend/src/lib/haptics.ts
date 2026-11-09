// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Haptique calibrée iOS
//
// L'API Vibration est un no-op silencieux sur iOS Safari ; on l'appelle donc
// toujours défensivement (try/catch + feature-detect) : aucun impact si absente.
// Les patterns sont courts pour rester discrets (HIG : retour léger, jamais
// plus de ~30 ms pour une action de navigation).
// ─────────────────────────────────────────────────────────────────────────────

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* API absente ou bloquée par le navigateur — non bloquant */
  }
}

/** Clic d'onglet / sélection : impulsion quasi imperceptible. */
export function hapticTap(): void {
  vibrate(10);
}

/** Sélection d'un objet (produit 3D, ligne de panneau). */
export function hapticSelect(): void {
  vibrate(12);
}

/** Succès (scan reconnu, produit consommé) : double impulsion courte. */
export function hapticSuccess(): void {
  vibrate([15, 50, 20]);
}

/** Échec / avertissement. */
export function hapticWarning(): void {
  vibrate([25, 80, 25]);
}
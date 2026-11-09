// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Utilitaires partagés du pipeline de scan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Message lisible à partir de n'importe quelle exception.
 *
 * ZXing (`@zxing/library`) lève parfois des classes dérivées d'`Error` via
 * `ts-custom-error`, mais aussi des chaînes brutes (`throw "..."`) : on ne peut
 * donc pas se contenter de `error instanceof Error`.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown; name?: unknown }
    if (typeof maybe.message === 'string') return maybe.message
    if (typeof maybe.name === 'string') return maybe.name
    try {
      return JSON.stringify(error)
    } catch {
      /* objet cyclique */
    }
  }
  return String(error)
}

/** Rejette si `promise` ne s'est pas résolue dans `ms` (APIs natives capricieuses). */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} : délai dépassé (${ms} ms)`))
    }, ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}
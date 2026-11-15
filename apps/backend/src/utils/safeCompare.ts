import { timingSafeEqual } from 'crypto';

/**
 * Compare deux secrets en temps constant (pas de fuite par le temps de réponse).
 * Renvoie `false` si l'un des deux est absent.
 */
export function safeEqual(provided: unknown, expected: string | undefined): boolean {
  if (typeof provided !== 'string' || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

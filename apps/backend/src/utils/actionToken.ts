import jwt from 'jsonwebtoken';
import { env } from '../config/env';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Jeton d'action (Service Worker)
//
// Le bouton « Mettre en libre-service » d'une notification est exécuté par le
// Service Worker, dans un contexte où `localStorage` est inaccessible : il ne
// peut donc pas lire le JWT de session. On joint au push un jeton dédié,
// signé, limité à UN item et à UNE action, pour ne pas ouvrir de route
// publique de modification.
// ─────────────────────────────────────────────────────────────────────────────

const ISSUER = 'colocos-api';
const AUDIENCE = 'colocos-app';
export const SHARE_SCOPE = 'item:share';
/** Une notification peut être ouverte plusieurs jours après l'envoi. */
const SHARE_TOKEN_TTL = '7d';

interface ShareTokenPayload {
  userId?: string;
  scope?: string;
  itemId?: string;
}

/** Jeton signé autorisant la mise en libre-service d'un item précis. */
export function signShareToken(itemId: string, userId: string): string {
  return jwt.sign({ userId, scope: SHARE_SCOPE, itemId }, env.JWT_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: SHARE_TOKEN_TTL,
  });
}

/**
 * Vérifie un jeton d'action et renvoie l'utilisateur associé, ou `null` si le
 * jeton est invalide, expiré, ou ne concerne pas cet item.
 */
export function verifyShareToken(token: string, itemId: string): string | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as ShareTokenPayload;

    if (decoded.scope !== SHARE_SCOPE) return null;
    if (decoded.itemId !== itemId) return null;
    if (!decoded.userId) return null;
    return decoded.userId;
  } catch {
    return null;
  }
}

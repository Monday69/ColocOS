import { Request } from 'express';
import { env } from '../config/env';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Origine publique d'une requête
//
// Derrière Caddy / le tunnel Cloudflare / un reverse proxy de VPS, `req.host`
// ne reflète pas ce que le client a réellement tapé : le backend voit
// `backend:3001`. Construire une URL avec `http://localhost` produit alors un
// lien inutilisable depuis un iPhone.
//
// Ordre de résolution :
//   1. `x-forwarded-proto` + `x-forwarded-host` (ou `host`) si le host est non vide
//   2. repli sur `FRONTEND_URL` (configuration explicite)
// ─────────────────────────────────────────────────────────────────────────────

/** Premier élément d'un en-tête éventuellement multi-valué (`a, b`). */
function firstHeaderValue(value: string | undefined): string {
  if (!value) return '';
  return value.split(',')[0].trim();
}

/**
 * Schéma d'origine.
 *
 * Derrière un tunnel, Caddy réécrit `x-forwarded-proto` avec le schéma qu'il a
 * REÇU (souvent `http`, puisque cloudflared parle en clair) : le prendre
 * aveuglément produirait des liens `http://` sur un site public en HTTPS.
 * On privilégie donc tout signal explicite de HTTPS, puis le proto transféré.
 */
function resolveProto(req: Request): string {
  const candidates: string[] = [];

  const forwardedProto = firstHeaderValue(req.header('x-forwarded-proto'));
  if (forwardedProto) candidates.push(forwardedProto);

  // Cloudflare (tunnel ou proxy) : `cf-visitor: {"scheme":"https"}`
  const cfVisitor = req.header('cf-visitor');
  if (cfVisitor) {
    try {
      const parsed = JSON.parse(cfVisitor) as { scheme?: string };
      if (parsed.scheme) candidates.push(parsed.scheme);
    } catch {
      /* en-tête illisible : on continue */
    }
  }

  // Anciens proxys (nginx `proxy_set_header X-Forwarded-Ssl on`)
  if (firstHeaderValue(req.header('x-forwarded-ssl')) === 'on') candidates.push('https');

  // Un signal HTTPS explicite primes sur un `http` transféré
  if (candidates.includes('https')) return 'https';

  return candidates[0] || req.protocol || 'http';
}

export function resolvePublicOrigin(req: Request): string {
  const forwardedHost = firstHeaderValue(req.header('x-forwarded-host'));
  const host = forwardedHost || firstHeaderValue(req.header('host'));

  if (host) {
    return `${resolveProto(req)}://${host}`;
  }

  // Repli : URL publique configurée (sans slash final)
  return env.FRONTEND_URL.replace(/\/$/, '');
}

/**
 * URL complète du lien magique NFC, telle qu'elle doit être écrite sur un
 * badge : toujours construite sur l'origine réellement utilisée par le client.
 */
export function buildNfcUrl(req: Request, token: string): string {
  return `${resolvePublicOrigin(req)}/api/auth/nfc?token=${encodeURIComponent(token)}`;
}

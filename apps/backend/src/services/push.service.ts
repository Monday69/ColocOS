// `web-push@4` est publié en ESM pur (`export const …`, aucun `default`) alors
// que le backend compile en CommonJS : un import par défaut donne `undefined`.
// L'import d'espace de noms est le seul qui expose les fonctions sous les deux
// formes (tsx/CJS comme Node ESM).
import * as webpush from 'web-push';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Push Service (Web Push / VAPID)
//
// - `webpush.setVapidDetails` n'est appelé que si les trois variables d'env
//   sont présentes : sans clés, l'API démarre normalement et l'envoi est
//   simplement désactivé (log explicite), jamais une exception au boot.
// - Les abonnements expirés (HTTP 404 / 410) sont supprimés immédiatement :
//   sans ce nettoyage la table grossit et chaque envoi échoue indéfiniment.
// ─────────────────────────────────────────────────────────────────────────────

export interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushPayload {
  title: string;
  body: string;
  /** Données lues par le Service Worker (`itemId`, `token`, `url`…) */
  data?: Record<string, unknown>;
}

export interface PushSendResult {
  sent: number;
  failed: number;
  /** Abonnements orphelins supprimés (404 / 410) */
  removed: number;
}

/** Durée de rétention côté service de push : 24 h (alerte du jour). */
const PUSH_TTL_SECONDS = 24 * 60 * 60;

class PushService {
  private configured = false;
  private initialised = false;

  /** Config paresseuse : le service est utilisable même sans clés. */
  private ensureConfigured(): boolean {
    if (this.initialised) return this.configured;
    this.initialised = true;

    const publicKey = env.VAPID_PUBLIC_KEY?.trim();
    const privateKey = env.VAPID_PRIVATE_KEY?.trim();
    const subject = env.VAPID_SUBJECT?.trim() || 'mailto:contact@colocos.local';

    if (!publicKey || !privateKey) {
      logger.warn('[Push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY absentes — push désactivé');
      return false;
    }

    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.configured = true;
      logger.debug('[Push] VAPID configuré');
    } catch (err) {
      logger.error('[Push] Configuration VAPID invalide', err);
      this.configured = false;
    }

    return this.configured;
  }

  get isConfigured(): boolean {
    return this.ensureConfigured();
  }

  /** Clé publique à exposer au front (aucune donnée sensible). */
  get publicKey(): string | null {
    return this.ensureConfigured() ? (env.VAPID_PUBLIC_KEY ?? null) : null;
  }

  /** Enregistre (ou rafraîchit) l'abonnement d'un utilisateur. */
  async subscribe(userId: string, subscription: PushSubscriptionInput): Promise<void> {
    const endpoint = subscription.endpoint?.trim();
    const p256dh = subscription.keys?.p256dh?.trim();
    const auth = subscription.keys?.auth?.trim();

    if (!endpoint || !p256dh || !auth) {
      throw new Error('Abonnement push incomplet (endpoint, keys.p256dh, keys.auth).');
    }

    // `endpoint` est unique : un même navigateur qui change de compte doit
    // basculer l'abonnement vers le nouveau userId plutôt que d'en créer un.
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { p256dh, auth, userId },
      create: { endpoint, p256dh, auth, userId },
    });

    logger.debug(`[Push] Abonnement enregistré pour ${userId}`);
  }

  /** Supprime un abonnement (désactivation dans l'UI). */
  async unsubscribe(endpoint: string): Promise<void> {
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  async countForUser(userId: string): Promise<number> {
    return prisma.pushSubscription.count({ where: { userId } });
  }

  /**
   * Envoie une notification à toutes les souscriptions d'un utilisateur.
   * Les abonnements révoqués (404/410) sont supprimés au passage.
   */
  async sendPushToUser(userId: string, payload: PushPayload): Promise<PushSendResult> {
    const result: PushSendResult = { sent: 0, failed: 0, removed: 0 };

    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
    if (subscriptions.length === 0) return result;

    if (!this.ensureConfigured()) {
      logger.warn(`[Push] ${subscriptions.length} abonnement(s) ignoré(s) : VAPID non configuré`);
      return result;
    }

    const body = JSON.stringify({ ...payload, data: payload.data ?? {} });

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            body,
            { TTL: PUSH_TTL_SECONDS },
          );
          result.sent += 1;
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;

          if (statusCode === 404 || statusCode === 410) {
            // Gone : l'abonnement n'existe plus côté navigateur.
            await prisma.pushSubscription.delete({ where: { id: subscription.id } });
            result.removed += 1;
            logger.debug(`[Push] Abonnement orphelin supprimé (${statusCode})`);
            return;
          }

          result.failed += 1;
          logger.warn(
            `[Push] Échec d'envoi (${statusCode ?? 'réseau'}) — ${subscription.endpoint.slice(0, 48)}…`,
          );
        }
      }),
    );

    return result;
  }
}

export const pushService = new PushService();

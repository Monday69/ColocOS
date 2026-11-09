import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { pushService } from '../services/push.service';
import { signShareToken } from '../utils/actionToken';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Alerte de péremption J+1 (Web Push)
//
// Chaque jour à 09:00 (Europe/Paris), on notifie chaque colocataire des
// produits qui arrivent à échéance DEMAIN, avec un bouton d'action rapide
// « 🤝 Mettre en libre-service ».
//
// NOTE SCHEMA : `Item` n'a pas de colonne `consumedAt` — un produit consommé
// est SUPPRIMÉ de la table (voir inventory.service.consumeItem). Le filtre
// « non consommé » est donc structurellement satisfait et n'a pas à être écrit.
// ─────────────────────────────────────────────────────────────────────────────

const CRON_EXPRESSION = '0 9 * * *';
const CRON_TIMEZONE = 'Europe/Paris';

export interface ExpirySweepResult {
  /** Items à échéance demain et pas encore notifiés */
  candidates: number;
  /** Colocataires distincts concernés */
  owners: number;
  /** Notifications réellement acceptées par le service de push */
  pushes: number;
  /** Items marqués `expiryNotified` (uniquement si un push est parti) */
  flagged: number;
  /** Colocataires sans abonnement actif (donc non notifiés, non marqués) */
  withoutSubscription: number;
}

interface CandidateItem {
  id: string;
  name: string;
  ownerId: string;
}

/** Bornes locales de « demain » : 00:00:00.000 → 23:59:59.999. */
function tomorrowWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59, 999);
  return { start, end };
}

function buildBody(items: CandidateItem[]): string {
  if (items.length === 1) return `${items[0].name} arrive à échéance demain.`;
  const names = items.slice(0, 4).map((item) => item.name).join(', ');
  const extra = items.length > 4 ? ` (+${items.length - 4})` : '';
  return `${items.length} produits arrivent à échéance demain : ${names}${extra}.`;
}

/**
 * Exécute un balayage (exporté pour être testable hors cron).
 * Ne notifie que les items PRIVÉS (`isShared: false`) : un produit déjà en
 * libre-service n'a plus besoin d'action de la part de son propriétaire.
 */
export async function runExpirySweep(now: Date = new Date()): Promise<ExpirySweepResult> {
  const { start, end } = tomorrowWindow(now);

  const result: ExpirySweepResult = {
    candidates: 0,
    owners: 0,
    pushes: 0,
    flagged: 0,
    withoutSubscription: 0,
  };

  const items = await prisma.item.findMany({
    where: {
      expiryDate: { gte: start, lte: end },
      expiryNotified: false,
      isShared: false,
      ownerId: { not: null },
    },
    select: { id: true, name: true, ownerId: true },
    orderBy: { expiryDate: 'asc' },
  });

  result.candidates = items.length;
  if (items.length === 0) {
    logger.debug('[ExpiryCron] Aucun produit à échéance demain (privé, non notifié)');
    return result;
  }

  const byOwner = new Map<string, CandidateItem[]>();
  for (const item of items) {
    const ownerId = item.ownerId as string;
    const bucket = byOwner.get(ownerId) ?? [];
    bucket.push({ id: item.id, name: item.name, ownerId });
    byOwner.set(ownerId, bucket);
  }
  result.owners = byOwner.size;

  for (const [ownerId, ownerItems] of byOwner) {
    const subscriptions = await pushService.countForUser(ownerId);
    if (subscriptions === 0) {
      // Pas d'abonnement : on ne marque PAS `expiryNotified`, pour que
      // l'alerte parte le jour où le colocataire active les notifications.
      result.withoutSubscription += 1;
      continue;
    }

    const first = ownerItems[0];
    const send = await pushService.sendPushToUser(ownerId, {
      title: '⚠️ Alerte Frigo — ColocOS',
      body: buildBody(ownerItems),
      data: {
        itemId: first.id,
        itemIds: ownerItems.map((item) => item.id),
        // Jeton d'action : permet au Service Worker de mettre en libre-service
        // sans session (il n'a pas accès au localStorage).
        token: signShareToken(first.id, ownerId),
        url: '/',
      },
    });

    result.pushes += send.sent;

    if (send.sent > 0) {
      await prisma.item.updateMany({
        where: { id: { in: ownerItems.map((item) => item.id) } },
        data: { expiryNotified: true },
      });
      result.flagged += ownerItems.length;
    }
  }

  logger.info(
    `[ExpiryCron] ${result.candidates} produit(s) J+1 — ${result.owners} colocataire(s), ` +
      `${result.pushes} push, ${result.flagged} marqué(s), ${result.withoutSubscription} sans abonnement`,
  );

  return result;
}

/** Planifie le balayage quotidien (09:00 Europe/Paris). */
export function startExpiryCron(): ScheduledTask {
  const task = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runExpirySweep().catch((err) => {
        logger.error('[ExpiryCron] Échec du balayage de péremption', err);
      });
    },
    { timezone: CRON_TIMEZONE },
  );

  logger.info(`[ExpiryCron] Planifié (${CRON_EXPRESSION}, ${CRON_TIMEZONE})`);
  return task;
}

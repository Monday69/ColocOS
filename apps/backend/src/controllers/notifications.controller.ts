import { Request, Response, NextFunction } from 'express';
import { pushService } from '../services/push.service';
import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/errorHandler';
import { signShareToken } from '../utils/actionToken';
import { ApiResponse } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Notifications Controller (Web Push)
//
// Le `userId` est TOUJOURS celui du JWT (`req.user`) : un `userId` envoyé dans
// le body est ignoré (sinon n'importe qui pourrait abonner un autre compte à
// ses propres notifications).
// ─────────────────────────────────────────────────────────────────────────────

function requireUser(req: Request): string {
  if (!req.user) throw new AppError(401, 'Non authentifié.');
  return req.user.id;
}

export class NotificationsController {
  /** GET /api/notifications/public-key — clé VAPID pour `pushManager.subscribe` */
  async getPublicKey(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json({
        success: true,
        data: {
          publicKey: pushService.publicKey,
          configured: pushService.isConfigured,
        },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/notifications/subscribe */
  async subscribe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = requireUser(req);
      const body = req.body ?? {};

      const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
      const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh.trim() : '';
      const auth = typeof body.keys?.auth === 'string' ? body.keys.auth.trim() : '';

      if (!endpoint.startsWith('http')) {
        throw new AppError(400, 'Abonnement invalide : « endpoint » manquant ou malformé.');
      }
      if (!p256dh || !auth) {
        throw new AppError(400, 'Abonnement invalide : « keys.p256dh » et « keys.auth » requis.');
      }

      await pushService.subscribe(userId, { endpoint, keys: { p256dh, auth } });

      res.status(201).json({
        success: true,
        data: {
          endpoint,
          subscriptions: await pushService.countForUser(userId),
        },
        message: 'Notifications activées sur cet appareil',
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** DELETE /api/notifications/subscribe — body { endpoint } */
  async unsubscribe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      requireUser(req);
      const endpoint =
        typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';

      if (!endpoint) throw new AppError(400, '« endpoint » requis pour se désabonner.');

      await pushService.unsubscribe(endpoint);
      res.status(200).json({
        success: true,
        data: { endpoint },
        message: 'Notifications désactivées',
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/notifications/status — diagnostic pour l'UI */
  async status(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = requireUser(req);
      const subscriptions = await pushService.countForUser(userId);
      res.status(200).json({
        success: true,
        data: { configured: pushService.isConfigured, subscriptions },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/notifications/test — envoie un push de test à soi-même.
   * Si `itemId` est fourni, la notification embarque le jeton d'action
   * « libre-service » exactement comme le fera le cron de péremption.
   */
  async sendTest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = requireUser(req);
      const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : null;

      let itemName = 'Produit de test';
      if (itemId) {
        const item = await prisma.item.findUnique({
          where: { id: itemId },
          select: { name: true },
        });
        if (!item) throw new AppError(404, `Item introuvable : ${itemId}`);
        itemName = item.name;
      }

      const result = await pushService.sendPushToUser(userId, {
        title: '⚠️ Alerte Frigo — ColocOS',
        body: itemId
          ? `${itemName} arrive à échéance demain.`
          : 'Notification de test : le pont push fonctionne.',
        data: {
          url: '/',
          ...(itemId ? { itemId, token: signShareToken(itemId, userId) } : {}),
        },
      });

      res.status(200).json({
        success: true,
        data: result,
        message: `${result.sent} notification(s) envoyée(s)`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
}

export const notificationsController = new NotificationsController();

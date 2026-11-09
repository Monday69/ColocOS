import { Router, Request, Response, NextFunction } from 'express';
import { authenticateOptional } from '../middlewares/auth.middleware';
import { inventoryService } from '../services/inventory.service';
import { verifyShareToken } from '../utils/actionToken';
import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/errorHandler';
import { ApiResponse } from '../types';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Items Routes (actions rapides hors interface 3D)
//
// POST /api/items/:id/share → bascule l'item en libre-service.
//
// Cette route accepte DEUX formes d'authentification :
//   1. `Authorization: Bearer <jwt de session>` (app classique) ;
//   2. `body.token` = jeton d'action signé, joint au push par le cron de
//      péremption. Le Service Worker n'a pas accès au `localStorage`, il ne
//      peut donc pas lire le JWT de session : sans ce jeton, le bouton
//      « Mettre en libre-service » d'une notification échouerait en 401.
//      Le jeton est limité à UN item et à UNE action (voir utils/actionToken).
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.post(
  '/:id/share',
  authenticateOptional,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const itemId = req.params.id;
      let userId = req.user?.id ?? null;

      if (!userId) {
        const rawToken =
          typeof req.body?.token === 'string'
            ? req.body.token
            : typeof req.query.token === 'string'
              ? req.query.token
              : null;

        if (rawToken) {
          const tokenUserId = verifyShareToken(rawToken, itemId);
          if (tokenUserId) {
            const user = await prisma.user.findUnique({
              where: { id: tokenUserId },
              select: { id: true },
            });
            if (user) userId = user.id;
          } else {
            logger.warn(`[Items] Jeton d'action refusé pour l'item ${itemId}`);
          }
        }
      }

      if (!userId) {
        throw new AppError(
          401,
          "Authentification requise : session valide ou jeton d'action « libre-service ».",
        );
      }

      const item = await inventoryService.shareItem(itemId, userId);

      res.status(200).json({
        success: true,
        data: item,
        message: `« ${item.name} » est désormais en libre-service`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  },
);

export default router;

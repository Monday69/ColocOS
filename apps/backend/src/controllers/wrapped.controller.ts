import { Request, Response, NextFunction } from 'express';
import { wrappedService } from '../services/wrapped.service';
import { recommendationService } from '../services/recommendation.service';
import { shoppingPredictionService } from '../services/shoppingPrediction.service';
import { AppError } from '../middlewares/errorHandler';
import { ApiResponse } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Wrapped & prédictions
//
// GET /api/wrapped/weekly?offset=0        → recap hebdomadaire
// GET /api/recipes/recommendations        → top 5 recettes priorisées
// GET /api/shopping/predictions           → suggestions d'achat
// ─────────────────────────────────────────────────────────────────────────────

function requireUser(req: Request): string {
  if (!req.user) throw new AppError(401, 'Non authentifié.');
  return req.user.id;
}

export class WrappedController {
  /** GET /api/wrapped/weekly?offset=0|1 */
  async weekly(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const raw = Number(req.query.offset ?? 0);
      const offset = Number.isFinite(raw) && raw >= 0 && raw <= 12 ? Math.floor(raw) : 0;
      const data = await wrappedService.weekly(requireUser(req), offset);
      res.status(200).json({ success: true, data } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/recipes/recommendations */
  async recommendations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await recommendationService.recommend(requireUser(req));
      res.status(200).json({ success: true, data } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/shopping/predictions */
  async predictions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await shoppingPredictionService.predict();
      res.status(200).json({ success: true, data, meta: { total: data.length } } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
}

export const wrappedController = new WrappedController();

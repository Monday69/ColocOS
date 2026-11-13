import { Request, Response, NextFunction } from 'express';
import { integrationsService } from '../services/integrations.service';
import { AppError } from '../middlewares/errorHandler';
import { ApiResponse } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Integrations Controller (pont Jarvis Runner)
//
// POST /api/integrations/jarvis/workout  → webhook post-séance (X-Integration-Key)
// GET  /api/integrations/jarvis/upcoming → planning J+1 (JWT)
// ─────────────────────────────────────────────────────────────────────────────

export class IntegrationsController {
  /** POST /api/integrations/jarvis/workout */
  async workout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      integrationsService.assertIntegrationKey(req.header('x-integration-key'));

      const body = (req.body ?? {}) as {
        userId?: string;
        username?: string;
        externalId?: string;
        sportType?: string;
        title?: string;
        durationMin?: number;
        activeKcal?: number;
        triScore?: number;
        intensityType?: string;
        performedAt?: string;
      };

      if (!body.sportType || typeof body.durationMin !== 'number' || typeof body.activeKcal !== 'number') {
        throw new AppError(400, 'Champs requis : sportType, durationMin, activeKcal.');
      }

      const workout = await integrationsService.upsertWorkout({
        userId: body.userId,
        username: body.username,
        externalId: body.externalId,
        sportType: body.sportType,
        title: body.title,
        durationMin: body.durationMin,
        activeKcal: body.activeKcal,
        triScore: body.triScore,
        intensityType: body.intensityType,
        performedAt: body.performedAt,
      });

      // Produits de récupération prioritaires (protéines + DLC proche)
      const suggestions = await integrationsService.recoverySuggestions(workout.userId);

      res.status(200).json({
        success: true,
        data: { workout, recoverySuggestions: suggestions },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/integrations/jarvis/upcoming */
  async upcoming(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');
      const data = await integrationsService.upcoming(req.user.id);
      res.status(200).json({ success: true, data } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
}

export const integrationsController = new IntegrationsController();

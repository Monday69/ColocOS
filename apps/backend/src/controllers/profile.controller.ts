import { Request, Response, NextFunction } from 'express';
import { profileService, type ProfilePayload, type Sex } from '../services/profile.service';
import { AppError } from '../middlewares/errorHandler';
import { ApiResponse } from '../types';
import { env } from '../config/env';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Profile Controller (profil athlète, macros, pesées)
//
// GET  /api/profile                     → biométrie + cibles
// PUT  /api/profile                     → enregistrement + recalcul TDEE
// GET  /api/profile/nutrition/today     → cumul du jour vs cibles
// GET  /api/profile/weigh-ins           → historique des pesées
// POST /api/profile/weigh-in            → balance Xiaomi (X-Device-Key)
// ─────────────────────────────────────────────────────────────────────────────

function requireUser(req: Request): string {
  if (!req.user) throw new AppError(401, 'Non authentifié.');
  return req.user.id;
}

export class ProfileController {
  /** GET /api/profile */
  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const profile = await profileService.getProfile(requireUser(req));
      res.status(200).json({ success: true, data: profile } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** PUT /api/profile */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = (req.body ?? {}) as Partial<ProfilePayload>;

      if (
        typeof body.heightCm !== 'number' ||
        typeof body.weightKg !== 'number' ||
        typeof body.birthDate !== 'string' ||
        (body.sex !== 'M' && body.sex !== 'F') ||
        typeof body.activityFactor !== 'number' ||
        !body.goal
      ) {
        throw new AppError(
          400,
          'Champs requis : heightCm, weightKg, birthDate (YYYY-MM-DD), sex (M|F), activityFactor, goal.',
        );
      }

      const profile = await profileService.upsertProfile(requireUser(req), {
        heightCm: body.heightCm,
        weightKg: body.weightKg,
        birthDate: body.birthDate,
        sex: body.sex as Sex,
        activityFactor: body.activityFactor,
        goal: body.goal,
      });

      res.status(200).json({ success: true, data: profile } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/profile/nutrition/today */
  async nutritionToday(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await profileService.nutritionToday(requireUser(req));
      res.status(200).json({ success: true, data } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/profile/weigh-ins */
  async weighIns(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = Number(req.query.limit ?? 20);
      const data = await profileService.listWeighIns(
        requireUser(req),
        Number.isFinite(limit) ? limit : 20,
      );
      res.status(200).json({ success: true, data, meta: { total: data.length } } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/profile/weigh-in
   * Protégé par `X-Device-Key` (la balance ne peut pas porter de JWT).
   */
  async weighIn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const provided = req.header('x-device-key') ?? '';
      const expected = env.SCALE_DEVICE_KEY;

      if (!expected || provided !== expected) {
        throw new AppError(401, 'Clé appareil invalide.');
      }

      const body = (req.body ?? {}) as {
        weightKg?: number;
        impedanceOhm?: number;
        userId?: string;
      };

      if (typeof body.weightKg !== 'number') {
        throw new AppError(400, 'weightKg requis (nombre).');
      }

      const data = await profileService.createWeighIn({
        weightKg: body.weightKg,
        impedanceOhm: typeof body.impedanceOhm === 'number' ? body.impedanceOhm : undefined,
        userId: typeof body.userId === 'string' ? body.userId : undefined,
      });

      res.status(201).json({ success: true, data } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
}

export const profileController = new ProfileController();

import { Request, Response, NextFunction } from 'express';
import { nutritionService } from '../services/nutrition.service';
import { UpdateProfileSchema } from '../dtos/users.dto';
import { AppError } from '../middlewares/errorHandler';
import { ApiResponse } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Users Controller (profil & cibles nutritionnelles)
//
// GET   /api/users/me/profile           → biométrie + objectif
// PATCH /api/users/me/profile           → mise à jour + cibles recalculées
// GET   /api/users/me/nutrition-targets → BMR / TDEE / calories & protéines
// ─────────────────────────────────────────────────────────────────────────────

function requireUser(req: Request): string {
  if (!req.user) throw new AppError(401, 'Non authentifié.');
  return req.user.id;
}

export class UsersController {
  /** GET /api/users/me/profile */
  async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const profile = await nutritionService.getProfile(requireUser(req));
      res.status(200).json({ success: true, data: profile } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** PATCH /api/users/me/profile */
  async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = requireUser(req);

      const parsed = UpdateProfileSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new AppError(
          400,
          first ? `${first.path.join('.')} : ${first.message}` : 'Profil invalide.',
        );
      }

      if (Object.keys(parsed.data).length === 0) {
        throw new AppError(400, 'Aucun champ à mettre à jour.');
      }

      const result = await nutritionService.updateProfile(userId, parsed.data);

      res.status(200).json({
        success: true,
        data: result,
        message: `Cibles recalculées : ${result.targets.targetCalories} kcal / ${result.targets.targetProteins} g de protéines`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/users/me/nutrition-targets */
  async getNutritionTargets(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const targets = await nutritionService.getTargets(requireUser(req));
      res.status(200).json({
        success: true,
        data: targets,
        message: targets.estimated
          ? 'Cibles estimées — complète ton profil pour plus de précision'
          : `Cible : ${targets.targetCalories} kcal / ${targets.targetProteins} g de protéines`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
}

export const usersController = new UsersController();

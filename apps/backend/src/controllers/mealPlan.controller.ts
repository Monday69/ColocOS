import { Request, Response, NextFunction } from 'express';
import { mealPlanService } from '../services/mealPlan.service';
import { ApiResponse } from '../types';
import { AppError } from '../middlewares/errorHandler';
import { z } from 'zod';

const UpsertSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (YYYY-MM-DD)'),
  slot: z.enum(['LUNCH', 'DINNER']),
  recipeId: z.string().trim().min(1).max(120),
  recipeName: z.string().trim().min(1).max(160),
  cookId: z.string().uuid().nullish(),
});

export class MealPlanController {
  /** GET /api/meal-plan?start=YYYY-MM-DD&end=YYYY-MM-DD */
  async getRange(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { start, end } = req.query as { start?: string; end?: string };
      if (!start || !end) {
        throw new AppError(400, 'Paramètres « start » et « end » requis (YYYY-MM-DD).');
      }

      const meals = await mealPlanService.getRange(start, end);

      res.status(200).json({
        success: true,
        data: { meals, start, end },
        message: `${meals.length} repas planifié(s)`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/meal-plan — upsert sur (date, slot). */
  async upsert(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');

      const dto = UpsertSchema.parse(req.body);
      // Par défaut, celui qui planifie est celui qui cuisine.
      const meal = await mealPlanService.upsert({
        ...dto,
        cookId: dto.cookId === undefined ? req.user.id : dto.cookId,
      });

      res.status(201).json({
        success: true,
        data: meal,
        message: `${meal.recipeName} planifié le ${meal.date} (${meal.slot === 'LUNCH' ? 'midi' : 'soir'})`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** DELETE /api/meal-plan/:id */
  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await mealPlanService.remove(req.params.id);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Créneau supprimé',
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
}

export const mealPlanController = new MealPlanController();

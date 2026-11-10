import { Request, Response, NextFunction } from 'express';
import { mealPlanService } from '../services/mealPlan.service';
import { shoppingService } from '../services/shopping.service';
import { ApiResponse } from '../types';
import { AppError } from '../middlewares/errorHandler';
import { z } from 'zod';

const UpsertSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (YYYY-MM-DD)'),
  slot: z.enum(['LUNCH', 'DINNER']),
  recipeId: z.string().trim().min(1).max(120),
  recipeName: z.string().trim().min(1).max(160),
  cookId: z.string().uuid().nullish(),
  attendeeIds: z.array(z.string().uuid()).max(20).nullish(),
  servings: z.number().int().min(1).max(50).nullish(),
});

const AttendeesSchema = z.object({
  attendeeIds: z
    .array(z.string().uuid("Identifiant de colocataire invalide"))
    .min(1, 'Au moins un convive requis')
    .max(20, 'Trop de convives (20 maximum)'),
});

const GenerateGroceriesSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (YYYY-MM-DD)'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (YYYY-MM-DD)'),
  /** `true` = prévisualisation seule, aucune écriture dans la liste de courses */
  dryRun: z.boolean().optional(),
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

  /**
   * PATCH /api/meal-plan/:id/attendees
   * Body : { attendeeIds: string[] } — ajuste aussi `servings`.
   */
  async updateAttendees(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');

      const dto = AttendeesSchema.parse(req.body);
      const meal = await mealPlanService.updateAttendees(req.params.id, dto.attendeeIds);

      res.status(200).json({
        success: true,
        data: meal,
        message: `${meal.servings} convive(s) pour ${meal.recipeName}`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/meal-plan/generate-groceries
   * Body : { startDate, endDate } — consolide les repas, déduit le stock puis
   * injecte les manquants dans la liste de courses active.
   */
  async generateGroceries(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');

      const dto = GenerateGroceriesSchema.parse(req.body);
      const consolidation = await mealPlanService.consolidateWeeklyGroceries(
        dto.startDate,
        dto.endDate,
      );

      // Prévisualisation demandée : on renvoie le calcul sans rien ajouter
      if (dto.dryRun) {
        res.status(200).json({
          success: true,
          data: {
            addedItemsCount: 0,
            coveredItemsCount: consolidation.covered.length,
            list: null,
            consolidation,
          },
          message: `${consolidation.needed.length} ingrédient(s) à acheter, ${consolidation.covered.length} déjà en stock`,
        } satisfies ApiResponse);
        return;
      }

      if (consolidation.needed.length === 0) {
        res.status(200).json({
          success: true,
          data: {
            addedItemsCount: 0,
            coveredItemsCount: consolidation.covered.length,
            list: null,
            consolidation,
          },
          message: 'Rien à acheter : tout est déjà couvert par le stock.',
        } satisfies ApiResponse);
        return;
      }

      const batch = await shoppingService.addBatchItemsToActiveList(
        req.user.id,
        consolidation.needed.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unit: line.unit,
        })),
      );

      res.status(200).json({
        success: true,
        data: {
          addedItemsCount: batch.created,
          coveredItemsCount: consolidation.covered.length,
          list: batch.list,
          consolidation,
        },
        message: `${batch.created} ingrédient(s) ajouté(s) à la liste de courses`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
}

export const mealPlanController = new MealPlanController();

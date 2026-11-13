import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { mealJournalService } from '../services/mealJournal.service';
import { ApiResponse } from '../types';
import { AppError } from '../middlewares/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Repas enregistrés (journal des macros)
//
// POST /api/meals            → enregistre un repas + ses items
// GET  /api/meals/today      → récapitulatif du jour (macros + nb de repas)
// GET  /api/meals/history    → N derniers jours agrégés
// ─────────────────────────────────────────────────────────────────────────────

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (YYYY-MM-DD)');

const MacroValue = z.number().finite().min(0).max(100000);

const MealItemSchema = z.object({
  name: z.string().trim().min(1, 'Nom requis').max(255),
  barcode: z.string().trim().max(50).nullish(),
  grams: z.number().finite().min(0).max(100000),
  calories: MacroValue,
  proteins: MacroValue,
  carbs: MacroValue,
  fat: MacroValue,
});

const CreateMealSchema = z.object({
  userId: z.string().uuid().nullish(),
  date: IsoDate.optional(),
  items: z.array(MealItemSchema).min(1, 'Au moins un aliment requis').max(50),
  /// Convives du repas : les macros sont divisées entre eux (défaut : soi-même)
  participantIds: z.array(z.string().uuid()).max(12).optional(),
});

export class MealController {
  /** POST /api/meals */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = CreateMealSchema.parse(req.body);
      // L'utilisateur authentifié prime : un client ne peut pas écrire pour un autre
      const userId = req.user?.id ?? dto.userId ?? null;

      const meal = await mealJournalService.create({
        userId,
        participantIds: dto.participantIds,
        date: dto.date,
        items: dto.items.map((item) => ({
          name: item.name,
          barcode: item.barcode ?? null,
          grams: item.grams,
          calories: item.calories,
          proteins: item.proteins,
          carbs: item.carbs,
          fat: item.fat,
        })),
      });

      const response: ApiResponse<typeof meal> = { success: true, data: meal };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/meals/today?date=YYYY-MM-DD */
  async today(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const date = typeof req.query.date === 'string' ? req.query.date : undefined;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new AppError(400, 'Date invalide (YYYY-MM-DD).');
      }
      const userId = req.user?.id ?? null;
      const summary = await mealJournalService.summary(userId, date);

      const response: ApiResponse<typeof summary> = { success: true, data: summary };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/meals/history?days=14 */
  async history(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const raw = Number.parseInt(String(req.query.days ?? '14'), 10);
      const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 90) : 14;
      const rows = await mealJournalService.history(req.user?.id ?? null, days);

      const response: ApiResponse<typeof rows> = { success: true, data: rows };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const mealController = new MealController();

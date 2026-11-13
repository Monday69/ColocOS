import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';
import { profileService } from './profile.service';
import { financeService } from './finance.service';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Journal nutritionnel (repas enregistrés)
//
// Les totaux sont TOUJOURS recalculés ici à partir des lignes reçues : le
// client ne peut pas imposer un total incohérent avec ses items.
// ─────────────────────────────────────────────────────────────────────────────

export interface MealItemInput {
  name: string;
  barcode?: string | null;
  grams: number;
  calories: number;
  proteins: number;
  carbs: number;
  fat: number;
}

export interface CreateMealInput {
  userId?: string | null;
  /** Convives : les macros sont réparties équitablement entre eux */
  participantIds?: string[];
  items: MealItemInput[];
  /** Date métier au format YYYY-MM-DD (défaut : aujourd'hui, heure locale serveur) */
  date?: string;
}

/** `YYYY-MM-DD` de la date fournie, en heure locale. */
export function isoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

class MealJournalService {
  /** POST /api/meals — crée le repas et ses lignes dans une transaction. */
  async create({ userId, participantIds, items, date }: CreateMealInput) {
    if (items.length === 0) {
      throw new AppError(400, 'Aucun aliment dans le repas.');
    }

    const totals = items.reduce(
      (acc, item) => ({
        calories: acc.calories + item.calories,
        proteins: acc.proteins + item.proteins,
        carbs: acc.carbs + item.carbs,
        fat: acc.fat + item.fat,
      }),
      { calories: 0, proteins: 0, carbs: 0, fat: 0 },
    );

    return prisma.$transaction(async (tx) => {
      const meal = await tx.meal.create({
        data: {
          userId: userId ?? null,
          date: date ?? isoDate(),
          totalCalories: round1(totals.calories),
          totalProteins: round1(totals.proteins),
          totalCarbs: round1(totals.carbs),
          totalFat: round1(totals.fat),
          items: {
            create: items.map((item) => ({
              name: item.name,
              barcode: item.barcode ?? null,
              grams: item.grams,
              calories: item.calories,
              proteins: item.proteins,
              carbs: item.carbs,
              fat: item.fat,
            })),
          },
        },
        include: { items: true },
      });

      return meal;
    }).then(async (meal) => {
      // Journal macros : chaque convive est crédité de sa part du repas.
      const diners = (participantIds && participantIds.length > 0
        ? Array.from(new Set(participantIds))
        : userId
          ? [userId]
          : []
      ).slice(0, 12);

      if (diners.length > 0) {
        const share = 1 / diners.length;

        await Promise.all(
          diners.map((dinerId) =>
            profileService
              .logConsumption({
                userId: dinerId,
                label: `Repas · ${items.length} aliment${items.length > 1 ? 's' : ''}`,
                kcal: totals.calories * share,
                proteinG: totals.proteins * share,
                carbsG: totals.carbs * share,
                fatG: totals.fat * share,
                source: 'MEAL',
              })
              .catch((err) => logger.warn(`[Nutrition] Journal repas ignoré : ${String(err)}`)),
          ),
        );

        // Dépense partagée : uniquement si les ingrédients portent un coût
        if (userId && diners.length > 1) {
          await this.createSharedExpense({ payerId: userId, dinerIds: diners, items })
            .catch((err) => logger.warn(`[Finance] Dépense repas ignorée : ${String(err)}`));
        }
      }
      return meal;
    });
  }

  /**
   * Dépense partagée issue d'un repas : somme des `unitCost` des ingrédients
   * retrouvés en stock (par code-barres, sinon par nom exact), divisée entre
   * les convives par le module Finance.
   */
  private async createSharedExpense(input: {
    payerId: string;
    dinerIds: string[];
    items: Array<{ name: string; barcode?: string | null; grams: number }>;
  }): Promise<void> {
    const priced = await prisma.item.findMany({
      where: {
        unitCost: { not: null },
        OR: input.items.map((item) => ({
          ...(item.barcode ? { barcode: item.barcode } : { name: item.name }),
        })),
      },
      select: { name: true, barcode: true, unitCost: true, unit: true },
    });

    if (priced.length === 0) return;

    let total = 0;
    for (const line of input.items) {
      const match = priced.find(
        (candidate) =>
          (line.barcode && candidate.barcode === line.barcode) || candidate.name === line.name,
      );
      if (!match || match.unitCost === null) continue;

      const unitCost = Number(match.unitCost);
      const isWeight = match.unit === 'g' || match.unit === 'ml';
      total += isWeight ? (unitCost * line.grams) / 100 : unitCost;
    }

    if (total <= 0) return;

    await financeService.addExpense(
      {
        description: `Repas partagé · ${input.items.length} aliment${input.items.length > 1 ? 's' : ''}`,
        amount: Math.round(total * 100) / 100,
        category: 'groceries' as never,
        participantIds: input.dinerIds,
      } as never,
      input.payerId,
    );
  }

  /** GET /api/meals/today — récapitulatif du jour pour un utilisateur. */
  async summary(userId: string | null, date?: string) {
    const day = date ?? isoDate();

    const meals = await prisma.meal.findMany({
      where: { date: day, ...(userId ? { userId } : {}) },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });

    const totals = meals.reduce(
      (acc, meal) => ({
        calories: acc.calories + meal.totalCalories,
        proteins: acc.proteins + meal.totalProteins,
        carbs: acc.carbs + meal.totalCarbs,
        fat: acc.fat + meal.totalFat,
      }),
      { calories: 0, proteins: 0, carbs: 0, fat: 0 },
    );

    return {
      date: day,
      mealCount: meals.length,
      itemCount: meals.reduce((sum, meal) => sum + meal.items.length, 0),
      totalCalories: round1(totals.calories),
      totalProteins: round1(totals.proteins),
      totalCarbs: round1(totals.carbs),
      totalFat: round1(totals.fat),
      meals: meals.map((meal) => ({
        id: meal.id,
        createdAt: meal.createdAt.toISOString(),
        totalCalories: meal.totalCalories,
        totalProteins: meal.totalProteins,
        totalCarbs: meal.totalCarbs,
        totalFat: meal.totalFat,
        items: meal.items.map((item) => ({
          id: item.id,
          name: item.name,
          barcode: item.barcode,
          grams: item.grams,
          calories: item.calories,
          proteins: item.proteins,
          carbs: item.carbs,
          fat: item.fat,
        })),
      })),
    };
  }

  /** GET /api/meals/history — N derniers jours (journal rapide). */
  async history(userId: string | null, days = 14) {
    const rows = await prisma.meal.groupBy({
      by: ['date'],
      where: userId ? { userId } : undefined,
      _sum: {
        totalCalories: true,
        totalProteins: true,
        totalCarbs: true,
        totalFat: true,
      },
      _count: { id: true },
      orderBy: { date: 'desc' },
      take: days,
    });

    return rows.map((row) => ({
      date: row.date,
      mealCount: row._count.id,
      totalCalories: round1(row._sum.totalCalories ?? 0),
      totalProteins: round1(row._sum.totalProteins ?? 0),
      totalCarbs: round1(row._sum.totalCarbs ?? 0),
      totalFat: round1(row._sum.totalFat ?? 0),
    }));
  }
}

export const mealJournalService = new MealJournalService();

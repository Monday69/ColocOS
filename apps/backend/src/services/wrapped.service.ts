import { prisma } from '../config/prisma';
import { profileService } from './profile.service';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — « Wrapped » hebdomadaire
//
// Agrège la semaine (lundi 00:00 → dimanche 23:59) : nutrition, top aliments,
// anti-gaspillage et dépense. `offset=0` = semaine en cours, `1` = précédente.
// ─────────────────────────────────────────────────────────────────────────────

/** Bornes de la semaine ISO contenant `reference`, décalée de `offset` semaines. */
export function weekRange(offset = 0, reference: Date = new Date()): { start: Date; end: Date } {
  const base = new Date(reference);
  // Lundi = 0 (getDay() renvoie 0 pour dimanche)
  const dayIndex = (base.getDay() + 6) % 7;
  const start = new Date(base);
  start.setDate(base.getDate() - dayIndex - offset * 7);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  return { start, end };
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export class WrappedService {
  async weekly(userId: string, offset = 0) {
    const { start, end } = weekRange(offset);

    const [logs, events, workouts, profile, meals] = await Promise.all([
      prisma.nutritionLog.findMany({
        where: { userId, consumedAt: { gte: start, lt: end } },
        orderBy: { consumedAt: 'asc' },
      }),
      prisma.stockEvent.findMany({
        where: { createdAt: { gte: start, lt: end } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.workoutSync.findMany({
        where: { userId, performedAt: { gte: start, lt: end } },
      }),
      profileService.getProfile(userId),
      prisma.meal.findMany({
        where: { userId, createdAt: { gte: start, lt: end } },
        select: { id: true, totalCalories: true },
      }),
    ]);

    // ── Nutrition ─────────────────────────────────────────────────────────
    const consumed = logs.reduce(
      (acc, log) => ({
        kcal: acc.kcal + log.kcal,
        proteinG: acc.proteinG + log.proteinG,
        carbsG: acc.carbsG + log.carbsG,
        fatG: acc.fatG + log.fatG,
      }),
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    );

    const daysTracked = new Set(
      logs.map((log) => log.consumedAt.toISOString().slice(0, 10)),
    ).size;

    const bonusKcal = workouts.reduce((sum, workout) => sum + workout.activeKcal, 0);

    const targetKcal = profile ? profile.targetKcal * 7 + bonusKcal : null;
    const targetProtein = profile ? profile.targetProtein * 7 : null;
    const targetCarbs = profile ? profile.targetCarbs * 7 + Math.round((bonusKcal * 0.65) / 4) : null;
    const targetFat = profile ? profile.targetFat * 7 + Math.round((bonusKcal * 0.15) / 9) : null;

    // ── Top aliments (par occurrences puis kcal) ──────────────────────────
    const byFood = new Map<string, { label: string; count: number; kcal: number }>();
    for (const log of logs) {
      const key = normalizeName(log.label);
      const current = byFood.get(key) ?? { label: log.label, count: 0, kcal: 0 };
      current.count += 1;
      current.kcal += log.kcal;
      byFood.set(key, current);
    }

    const topFoods = [...byFood.values()]
      .sort((a, b) => b.count - a.count || b.kcal - a.kcal)
      .slice(0, 3)
      .map((entry) => ({
        label: entry.label,
        occurrences: entry.count,
        kcal: Math.round(entry.kcal),
      }));

    // ── Anti-gaspi (sur les événements de la coloc) ───────────────────────
    const finished = events.filter((event) => event.eventType === 'FINISHED');
    const wasted = events.filter((event) => event.eventType === 'WASTED');

    const savedEuros = finished.reduce(
      (sum, event) => sum + (event.unitCost ?? 0) * (event.quantityRatio ?? 1),
      0,
    );
    const wastedEuros = wasted.reduce(
      (sum, event) => sum + (event.unitCost ?? 0) * (event.quantityRatio ?? 1),
      0,
    );

    const antiWasteScore =
      finished.length + wasted.length === 0
        ? 100
        : Math.round((finished.length / (finished.length + wasted.length)) * 100);

    // ── Dépense ───────────────────────────────────────────────────────────
    const mealLogs = logs.filter((log) => log.source === 'MEAL');
    const mealKcal = mealLogs.reduce((sum, log) => sum + log.kcal, 0);
    const avgCostPerMeal =
      meals.length > 0
        ? Math.round(
            (events
              .filter((event) => event.eventType === 'FINISHED' && event.unitCost)
              .reduce((sum, event) => sum + (event.unitCost ?? 0), 0) /
              meals.length) *
              100,
          ) / 100
        : null;

    const round = (value: number) => Math.round(value * 10) / 10;

    return {
      week: {
        offset,
        start: start.toISOString().slice(0, 10),
        end: new Date(end.getTime() - 1).toISOString().slice(0, 10),
      },
      nutrition: {
        consumed: {
          kcal: round(consumed.kcal),
          proteinG: round(consumed.proteinG),
          carbsG: round(consumed.carbsG),
          fatG: round(consumed.fatG),
        },
        targets: profile
          ? {
              kcal: Math.round(targetKcal ?? 0),
              proteinG: targetProtein,
              carbsG: targetCarbs,
              fatG: targetFat,
            }
          : null,
        workouts: { sessions: workouts.length, bonusKcal },
        daysTracked,
        mealCount: meals.length,
        mealKcal: Math.round(mealKcal),
      },
      topFoods,
      antiWaste: {
        finished: finished.length,
        wasted: wasted.length,
        score: antiWasteScore,
        savedEuros: Math.round(savedEuros * 100) / 100,
        wastedEuros: Math.round(wastedEuros * 100) / 100,
      },
      spending: {
        totalEuros: Math.round((savedEuros + wastedEuros) * 100) / 100,
        avgPerMealEuros: avgCostPerMeal,
        mealsRecorded: meals.length,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}

export const wrappedService = new WrappedService();

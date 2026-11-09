import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../config/logger';
import type { MealSlot } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Meal Plan Service (semainier de la coloc)
// ─────────────────────────────────────────────────────────────────────────────

export interface MealPlanEntry {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  slot: MealSlot;
  recipeId: string;
  recipeName: string;
  cookId: string | null;
  cook: {
    id: string;
    name: string;
    colorHex: string;
    avatarUrl: string | null;
  } | null;
}

export interface UpsertMealInput {
  date: string;
  slot: MealSlot;
  recipeId: string;
  recipeName: string;
  cookId?: string | null;
}

const COOK_SELECT = {
  id: true,
  name: true,
  colorHex: true,
  avatarUrl: true,
} as const;

/** Parse strict `YYYY-MM-DD` en date UTC (colonne `@db.Date`). */
function parseIsoDate(value: string, field = 'date'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, `Champ « ${field} » invalide (format attendu : YYYY-MM-DD).`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, `Champ « ${field} » invalide.`);
  }
  return parsed;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toEntry(row: {
  id: string;
  date: Date;
  slot: MealSlot;
  recipeId: string;
  recipeName: string;
  cookId: string | null;
  cook: { id: string; name: string; colorHex: string; avatarUrl: string | null } | null;
}): MealPlanEntry {
  return {
    id: row.id,
    date: toIsoDate(row.date),
    slot: row.slot,
    recipeId: row.recipeId,
    recipeName: row.recipeName,
    cookId: row.cookId,
    cook: row.cook,
  };
}

export class MealPlanService {
  /** Repas prévus sur une fenêtre [start, end] inclusive. */
  async getRange(start: string, end: string): Promise<MealPlanEntry[]> {
    const startDate = parseIsoDate(start, 'start');
    const endDate = parseIsoDate(end, 'end');

    if (endDate < startDate) {
      throw new AppError(400, 'La date de fin précède la date de début.');
    }

    const spanDays = (endDate.getTime() - startDate.getTime()) / 86_400_000;
    if (spanDays > 62) {
      throw new AppError(400, 'La fenêtre ne peut pas dépasser 62 jours.');
    }

    const rows = await prisma.mealPlan.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      include: { cook: { select: COOK_SELECT } },
      orderBy: [{ date: 'asc' }, { slot: 'asc' }],
    });

    return rows.map(toEntry);
  }

  /** Crée ou remplace le repas d'un créneau (jour + midi/soir). */
  async upsert(input: UpsertMealInput): Promise<MealPlanEntry> {
    const date = parseIsoDate(input.date);

    const recipeId = input.recipeId?.trim();
    const recipeName = input.recipeName?.trim();
    if (!recipeId) throw new AppError(400, 'Identifiant de recette requis.');
    if (!recipeName) throw new AppError(400, 'Nom de recette requis.');

    let cookId: string | null = null;
    if (input.cookId) {
      const cook = await prisma.user.findUnique({
        where: { id: input.cookId },
        select: { id: true },
      });
      if (!cook) throw new AppError(400, `Cuisinier inconnu : ${input.cookId}`);
      cookId = cook.id;
    }

    const row = await prisma.mealPlan.upsert({
      where: { date_slot: { date, slot: input.slot } },
      create: {
        date,
        slot: input.slot,
        recipeId,
        recipeName,
        cookId,
      },
      update: {
        recipeId,
        recipeName,
        cookId,
      },
      include: { cook: { select: COOK_SELECT } },
    });

    logger.info(
      `[MealPlan] ${toIsoDate(date)} ${input.slot} → ${recipeName}${cookId ? ` (cuisinier ${cookId})` : ''}`,
    );

    return toEntry(row);
  }

  /** Supprime un créneau. */
  async remove(id: string): Promise<{ deleted: boolean }> {
    const existing = await prisma.mealPlan.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError(404, `Créneau introuvable : ${id}`);

    await prisma.mealPlan.delete({ where: { id } });
    return { deleted: true };
  }
}

export const mealPlanService = new MealPlanService();

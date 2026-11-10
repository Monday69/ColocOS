import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../config/logger';
import { LOCAL_CATALOG } from './recipe.service';
import type { MealSlot } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Meal Plan Service (semainier de la coloc + consolidation courses)
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
  /** Convives inscrits à table (`null` = toute la coloc) */
  attendeeIds: string[] | null;
  /** Nombre de convives effectif (repli : attendeeIds.length) */
  servings: number | null;
}

export interface UpsertMealInput {
  date: string;
  slot: MealSlot;
  recipeId: string;
  recipeName: string;
  cookId?: string | null;
  attendeeIds?: string[] | null;
  servings?: number | null;
}

// ── Consolidation des courses (Bloc 2) ───────────────────────────────────────

export type UnitFamily = 'mass' | 'volume' | 'count';

export interface GroceryLine {
  name: string;
  quantity: number;
  unit: string;
  /** `true` si la quantité repose sur une estimation (pas de grammages) */
  estimated: boolean;
  /** Recettes qui réclament cet ingrédient */
  sources: string[];
}

export interface CoveredLine extends GroceryLine {
  /** Quantité déjà disponible en stock (unité de la ligne) */
  stockQuantity: number;
}

export interface GroceryConsolidation {
  startDate: string;
  endDate: string;
  mealsCount: number;
  servingsTotal: number;
  needed: GroceryLine[];
  covered: CoveredLine[];
  unresolvedRecipes: string[];
}

interface AggregatedIngredient {
  name: string;
  family: UnitFamily;
  /** Quantité en unité de base : g / ml / unité */
  baseQuantity: number;
  estimated: boolean;
  sources: Set<string>;
}

interface ResolvedMealRecipe {
  title: string;
  baseServings: number;
  ingredients: Array<{
    name: string;
    quantity: number | null;
    unit: string | null;
    estimated: boolean;
  }>;
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

/** Normalise un libellé pour comparer les ingrédients (accents, casse). */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(value: string): string[] {
  return normalizeName(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

/** Unité → famille + facteur vers l'unité de base (g / ml / unité). */
function unitToBase(unit: string | null | undefined): { family: UnitFamily; factor: number } {
  switch ((unit ?? '').toLowerCase()) {
    case 'kg':
      return { family: 'mass', factor: 1000 };
    case 'g':
      return { family: 'mass', factor: 1 };
    case 'l':
      return { family: 'volume', factor: 1000 };
    case 'cl':
      return { family: 'volume', factor: 10 };
    case 'ml':
      return { family: 'volume', factor: 1 };
    default:
      return { family: 'count', factor: 1 };
  }
}

/** Quantité de base → unité lisible (kg / L au-delà de 1000). */
function baseToDisplay(base: number, family: UnitFamily): { quantity: number; unit: string } {
  if (family === 'mass') {
    if (base >= 1000) return { quantity: Math.round((base / 1000) * 100) / 100, unit: 'kg' };
    return { quantity: Math.round(base * 10) / 10, unit: 'g' };
  }
  if (family === 'volume') {
    if (base >= 1000) return { quantity: Math.round((base / 1000) * 100) / 100, unit: 'L' };
    return { quantity: Math.round(base * 10) / 10, unit: 'ml' };
  }
  return { quantity: Math.round(base * 10) / 10, unit: 'unit' };
}

function toEntry(row: {
  id: string;
  date: Date;
  slot: MealSlot;
  recipeId: string;
  recipeName: string;
  cookId: string | null;
  attendeeIds: unknown;
  servings: number | null;
  cook?: { id: string; name: string; colorHex: string; avatarUrl: string | null } | null;
}): MealPlanEntry {
  const attendeeIds = Array.isArray(row.attendeeIds)
    ? (row.attendeeIds as unknown[]).filter((value): value is string => typeof value === 'string')
    : null;

  return {
    id: row.id,
    date: toIsoDate(row.date),
    slot: row.slot,
    recipeId: row.recipeId,
    recipeName: row.recipeName,
    cookId: row.cookId,
    cook: row.cook ?? null,
    attendeeIds,
    servings: row.servings ?? (attendeeIds ? attendeeIds.length : null),
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

    let attendees: string[] | null = null;
    if (input.attendeeIds !== undefined && input.attendeeIds !== null) {
      attendees = await this.validateAttendees(input.attendeeIds);
    }

    const servings =
      attendees !== null
        ? attendees.length
        : input.servings !== undefined && input.servings !== null
          ? Math.max(1, Math.min(50, Math.round(input.servings)))
          : null;

    const row = await prisma.mealPlan.upsert({
      where: { date_slot: { date, slot: input.slot } },
      create: {
        date,
        slot: input.slot,
        recipeId,
        recipeName,
        cookId,
        servings,
        ...(attendees !== null ? { attendeeIds: attendees } : {}),
      },
      update: {
        recipeId,
        recipeName,
        cookId,
        ...(attendees !== null ? { attendeeIds: attendees, servings } : {}),
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

  // ── Convives (Bloc 2) ─────────────────────────────────────────────────────

  /** `PATCH /meal-plan/:id/attendees` — remplace la liste et ajuste `servings`. */
  async updateAttendees(id: string, attendeeIds: string[]): Promise<MealPlanEntry> {
    const existing = await prisma.mealPlan.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError(404, `Créneau introuvable : ${id}`);

    const unique = await this.validateAttendees(attendeeIds);

    const row = await prisma.mealPlan.update({
      where: { id },
      data: { attendeeIds: unique, servings: unique.length },
      include: { cook: { select: COOK_SELECT } },
    });

    logger.info(
      `[MealPlan] Convives ${toIsoDate(row.date)} ${row.slot} : ${unique.length} personne(s)`,
    );

    return toEntry(row);
  }

  /** Vérifie que chaque ID correspond à un colocataire, puis dédoublonne. */
  private async validateAttendees(attendeeIds: string[]): Promise<string[]> {
    if (!Array.isArray(attendeeIds)) {
      throw new AppError(400, 'attendeeIds doit être un tableau.');
    }

    const unique = Array.from(
      new Set(attendeeIds.filter((value) => typeof value === 'string' && value.length > 0)),
    );

    if (unique.length === 0) {
      throw new AppError(400, 'Au moins un convive doit être sélectionné.');
    }
    if (unique.length > 20) {
      throw new AppError(400, 'Trop de convives (20 maximum).');
    }

    const found = await prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });

    if (found.length !== unique.length) {
      const known = new Set(found.map((user) => user.id));
      const unknown = unique.filter((value) => !known.has(value));
      throw new AppError(400, `Convive inconnu : ${unknown.join(', ')}`);
    }

    return unique;
  }

  // ── Consolidation des courses (Bloc 2) ────────────────────────────────────

  /**
   * Agrège les ingrédients des repas planifiés sur la fenêtre, applique le
   * ratio de portions (servings / baseServings), puis déduit le stock réel.
   */
  async consolidateWeeklyGroceries(
    startDate: string,
    endDate: string,
  ): Promise<GroceryConsolidation> {
    const start = parseIsoDate(startDate, 'startDate');
    const end = parseIsoDate(endDate, 'endDate');
    if (end < start) throw new AppError(400, 'La date de fin précède la date de début.');

    const meals = await prisma.mealPlan.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: [{ date: 'asc' }, { slot: 'asc' }],
    });

    const householdSize = await prisma.user.count();

    const stock = await prisma.item.findMany({
      where: { consumedAt: null, quantity: { gt: 0 } },
      select: { name: true, quantity: true, unit: true },
    });

    const aggregate = new Map<string, AggregatedIngredient>();
    const unresolvedRecipes: string[] = [];
    let servingsTotal = 0;

    for (const meal of meals) {
      const recipe = await this.resolveMealRecipe(meal.recipeId);
      if (!recipe) {
        unresolvedRecipes.push(meal.recipeName);
        continue;
      }

      const attendees = Array.isArray(meal.attendeeIds)
        ? (meal.attendeeIds as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : null;

      const servings = Math.max(
        1,
        meal.servings ?? (attendees ? attendees.length : householdSize || 2),
      );
      servingsTotal += servings;

      const ratio = servings / (recipe.baseServings > 0 ? recipe.baseServings : 2);

      for (const ingredient of recipe.ingredients) {
        if (!ingredient.name) continue;

        const { family, factor } = unitToBase(ingredient.unit);
        const baseQuantity = (ingredient.quantity ?? 1) * factor * ratio;
        const key = `${normalizeName(ingredient.name)}|${family}`;

        const current = aggregate.get(key);
        if (current) {
          current.baseQuantity += baseQuantity;
          current.estimated = current.estimated || ingredient.estimated;
          current.sources.add(recipe.title);
        } else {
          aggregate.set(key, {
            name: ingredient.name,
            family,
            baseQuantity,
            estimated: ingredient.estimated,
            sources: new Set([recipe.title]),
          });
        }
      }
    }

    const needed: GroceryLine[] = [];
    const covered: CoveredLine[] = [];

    for (const ingredient of aggregate.values()) {
      const stockQuantity = this.stockQuantityFor(ingredient.name, ingredient.family, stock);
      const net = ingredient.baseQuantity - stockQuantity;

      const display = baseToDisplay(net > 0 ? net : ingredient.baseQuantity, ingredient.family);

      const line: GroceryLine = {
        name: ingredient.name,
        quantity: display.quantity,
        unit: display.unit,
        estimated: ingredient.estimated,
        sources: Array.from(ingredient.sources),
      };

      if (net > 0) {
        needed.push(line);
      } else {
        const stockDisplay = baseToDisplay(stockQuantity, ingredient.family);
        covered.push({ ...line, stockQuantity: stockDisplay.quantity });
      }
    }

    needed.sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
    covered.sort((a, b) => a.name.localeCompare(b.name));

    logger.info(
      `[MealPlan] Consolidation ${startDate}→${endDate} : ${meals.length} repas, ` +
        `${needed.length} à acheter, ${covered.length} couverts par le stock`,
    );

    return {
      startDate,
      endDate,
      mealsCount: meals.length,
      servingsTotal,
      needed,
      covered,
      unresolvedRecipes,
    };
  }

  /** Quantité de stock (en unité de base) correspondant à un ingrédient. */
  private stockQuantityFor(
    name: string,
    family: UnitFamily,
    stock: Array<{ name: string; quantity: unknown; unit: string }>,
  ): number {
    const requiredTokens = nameTokens(name);
    if (requiredTokens.length === 0) return 0;

    let total = 0;

    for (const entry of stock) {
      const entryTokens = nameTokens(entry.name);
      if (!requiredTokens.every((token) => entryTokens.includes(token))) continue;

      const { family: entryFamily, factor } = unitToBase(entry.unit);
      // Unités incompatibles (g vs pièce) : on ne déduit rien
      if (entryFamily !== family) continue;

      total += Number(entry.quantity) * factor;
    }

    return total;
  }

  /** Résout les ingrédients d'une recette planifiée (catalogue, perso, cache). */
  private async resolveMealRecipe(recipeId: string): Promise<ResolvedMealRecipe | null> {
    if (recipeId.startsWith('local:')) {
      const key = recipeId.slice('local:'.length);
      const recipe = LOCAL_CATALOG.find((entry) => entry.key === key);
      if (!recipe) return null;

      return {
        title: recipe.title,
        // Le catalogue local ne porte pas de grammages : base de 2 parts
        baseServings: 2,
        ingredients: recipe.ingredients.map((name) => ({
          name,
          quantity: 1,
          unit: null,
          estimated: true,
        })),
      };
    }

    if (recipeId.startsWith('custom:')) {
      const id = recipeId.slice('custom:'.length);
      const row = await prisma.customRecipe.findUnique({ where: { id } });
      if (!row) return null;

      const raw = Array.isArray(row.ingredients)
        ? (row.ingredients as Array<{ name?: unknown; quantity?: unknown; unit?: unknown }>)
        : [];

      return {
        title: row.title,
        baseServings: row.servings > 0 ? row.servings : 4,
        ingredients: raw
          .map((ingredient) => {
            const ingredientName =
              typeof ingredient?.name === 'string' ? ingredient.name.trim() : '';
            const quantity =
              typeof ingredient?.quantity === 'number' && Number.isFinite(ingredient.quantity)
                ? ingredient.quantity
                : null;
            const unit = typeof ingredient?.unit === 'string' ? ingredient.unit : null;
            return { name: ingredientName, quantity, unit, estimated: quantity === null };
          })
          .filter((ingredient) => ingredient.name.length > 0),
      };
    }

    // Recette Spoonacular mise en cache
    const cached = await prisma.recipe.findUnique({ where: { id: recipeId } });
    if (cached) {
      const payload = cached.steps as unknown as {
        extendedIngredients?: Array<{ name?: string; amount?: number; unit?: string }>;
        servings?: number;
      };

      const ingredients = (payload?.extendedIngredients ?? [])
        .map((ingredient) => ({
          name: typeof ingredient.name === 'string' ? ingredient.name : '',
          quantity: typeof ingredient.amount === 'number' ? ingredient.amount : null,
          unit: typeof ingredient.unit === 'string' ? ingredient.unit : null,
          estimated: false,
        }))
        .filter((ingredient) => ingredient.name.length > 0);

      if (ingredients.length === 0) return null;

      return {
        title: cached.title,
        baseServings: payload.servings && payload.servings > 0 ? payload.servings : 4,
        ingredients,
      };
    }

    return null;
  }
}

export const mealPlanService = new MealPlanService();

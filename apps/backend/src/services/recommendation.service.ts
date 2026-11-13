import { prisma } from '../config/prisma';
import { LOCAL_CATALOG } from './recipe.service';
import { profileService } from './profile.service';
import { integrationsService } from './integrations.service';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Moteur de recommandation de recettes
//
// Score = adéquation au stock (recouvrement d'ingrédients)
//       + bonus DLC proche / produit déjà ouvert (anti-gaspi)
//       + bonus macros (protéines si déficit ou séance du jour,
//         glucides si recharge glucidique recommandée pour demain)
// ─────────────────────────────────────────────────────────────────────────────

export type RecommendationTag = 'ANTI_GASPI' | 'POST_WORKOUT' | 'CARB_LOAD_J1' | 'MACRO_FIT';

export interface RecipeRecommendation {
  key: string;
  title: string;
  image: string;
  readyInMinutes: number;
  proteinGrams: number;
  score: number;
  tags: RecommendationTag[];
  stockIngredients: string[];
  missingIngredients: string[];
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .toLowerCase()
    .trim();
}

/** Un ingrédient de recette est-il couvert par un produit du stock ? */
function matches(ingredient: string, stockNames: string[]): boolean {
  const needle = normalize(ingredient);
  return stockNames.some((name) => {
    const hay = normalize(name);
    return hay.includes(needle) || needle.includes(hay.split(' ')[0]);
  });
}

export class RecommendationService {
  async recommend(userId: string, limit = 5): Promise<{
    recommendations: RecipeRecommendation[];
    context: {
      carbLoadRecommended: boolean;
      workoutToday: boolean;
      remaining: { kcal: number; proteinG: number; carbsG: number; fatG: number } | null;
    };
  }> {
    const [items, nutrition, upcoming] = await Promise.all([
      prisma.item.findMany({
        where: { consumedAt: null },
        select: {
          name: true,
          proteins: true,
          calories: true,
          expiryDate: true,
          initialQuantity: true,
          quantity: true,
          unitCost: true,
        },
      }),
      profileService.nutritionToday(userId).catch(() => null),
      integrationsService.upcoming(userId).catch(() => null),
    ]);

    const stockNames = items.map((item) => item.name);
    const remaining = nutrition?.remaining ?? null;
    const workoutToday = (nutrition?.workoutBonus?.sessions.length ?? 0) > 0;
    const carbLoadRecommended = upcoming?.carbLoadRecommended ?? false;

    // Produits urgents : DLC <= 3 jours (ou dépassée)
    const urgent = new Set(
      items
        .filter((item) => {
          if (!item.expiryDate) return false;
          const days = Math.ceil(
            (item.expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          );
          return days <= 3;
        })
        .map((item) => item.name),
    );

    // Produits ouverts : quantité courante < quantité initiale
    const opened = new Set(
      items
        .filter((item) => Number(item.quantity) < item.initialQuantity - 0.001)
        .map((item) => item.name),
    );

    const proteinDeficit = remaining !== null && remaining.proteinG > 0;

    const scored: RecipeRecommendation[] = LOCAL_CATALOG.map((recipe) => {
      const stockIngredients = recipe.ingredients.filter((ingredient) =>
        matches(ingredient, stockNames),
      );
      const missingIngredients = recipe.ingredients.filter(
        (ingredient) => !matches(ingredient, stockNames),
      );

      const coverage = stockIngredients.length / Math.max(1, recipe.ingredients.length);
      let score = coverage * 60;

      const tags = new Set<RecommendationTag>();

      // Anti-gaspi : ingrédients présents en stock proches de la DLC ou ouverts
      const urgentHits = stockIngredients.filter((ingredient) =>
        [...urgent, ...opened].some((name) => matches(ingredient, [name])),
      );
      if (urgentHits.length > 0) {
        score += 18 * urgentHits.length;
        tags.add('ANTI_GASPI');
      }

      // Adéquation macros
      if (workoutToday && recipe.proteinGrams >= 20) {
        score += 20;
        tags.add('POST_WORKOUT');
      } else if (proteinDeficit && recipe.proteinGrams >= 20) {
        score += 12;
        tags.add('MACRO_FIT');
      }

      if (carbLoadRecommended && recipe.readyInMinutes <= 35) {
        score += 15;
        tags.add('CARB_LOAD_J1');
      }

      // Recette incomplète : pénalité douce (réalisable avec peu d'achats)
      if (missingIngredients.length > 0) score -= missingIngredients.length * 4;

      return {
        key: recipe.key,
        title: recipe.title,
        image: recipe.image,
        readyInMinutes: recipe.readyInMinutes,
        proteinGrams: recipe.proteinGrams,
        score: Math.max(0, Math.round(score)),
        tags: [...tags],
        stockIngredients,
        missingIngredients,
      };
    })
      .filter((recipe) => recipe.stockIngredients.length > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      recommendations: scored,
      context: { carbLoadRecommended, workoutToday, remaining },
    };
  }
}

export const recommendationService = new RecommendationService();

import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';
import { inventoryService } from './inventory.service';
import { normalizeStockToIngredients } from '../utils/ingredientNormalizer';
import { RecipeSuggestion } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Recipe Service
//
// CHOIX API : SPOONACULAR (https://spoonacular.com/food-api)
// ────────────────────────────────────────────────────────
// Pourquoi Spoonacular plutôt qu'Edamam ou scraping Marmiton ?
//
//   1. ENDPOINT DÉDIÉ `findByIngredients` : conçu exactement pour notre cas
//      d'usage. Il retourne un `usedIngredientCount` et `missedIngredientCount`
//      natifs → notre MatchScore est une déduction directe, pas un calcul maison.
//
//   2. NLP ANGLAIS ROBUSTE : Spoonacular parse "2 cups of milk" ou juste "milk"
//      indifféremment. C'est pour ça que notre normalizer FR→EN est critique :
//      on alimente son NLP dans sa langue native.
//
//   3. BASE DE DONNÉES MASSIVE : 365 000+ recettes, majoritairement
//      internationales mais avec de bonnes recettes françaises.
//
//   4. FREE TIER : 150 points/jour gratuits. `findByIngredients` coûte 1 point
//      par appel → 150 suggestions/jour, largement suffisant pour 6 colocataires.
//
//   5. CACHE BDD INTÉGRÉ : on stocke les résultats dans notre table `recipes`
//      avec un TTL de 24h, donc en pratique l'API n'est appelée qu'une fois/jour.
//
// ALTERNATIVE : Edamam Recipe Search API
//   - Pro : meilleure couverture des régimes (végan, sans gluten)
//   - Con : pas d'endpoint `findByIngredients` natif → calcul de score maison
//           plus complexe, free tier limité à 10 000 calls/mois
//   → Spoonacular reste le meilleur choix pour ce use case.
// ─────────────────────────────────────────────────────────────────────────────

const RECIPE_CACHE_TTL_HOURS = 24;
const MAX_INGREDIENTS_TO_SEND = 20; // Spoonacular recommande ≤ 20 ingrédients
const MAX_RECIPES_TO_RETURN = 15;

// ── Types Spoonacular ─────────────────────────────────────────────────────────

interface SpoonacularIngredient {
  id: number;
  name: string;
  amount: number;
  unit: string;
  image: string;
}

interface SpoonacularRecipe {
  id: number;
  title: string;
  image: string;
  imageType: string;
  usedIngredientCount: number;
  missedIngredientCount: number;
  missedIngredients: SpoonacularIngredient[];
  usedIngredients: SpoonacularIngredient[];
  likes: number;
}

interface SpoonacularRecipeDetail {
  id: number;
  title: string;
  image: string;
  sourceUrl: string;
  readyInMinutes: number;
  servings: number;
  summary: string;
  instructions: string;
  analyzedInstructions: Array<{
    steps: Array<{ number: number; step: string }>;
  }>;
  extendedIngredients: Array<{
    name: string;
    amount: number;
    unit: string;
    original: string;
  }>;
}

// ── Types internes ────────────────────────────────────────────────────────────

export interface RecipeSuggestionExtended extends RecipeSuggestion {
  usedIngredients: string[];
  totalIngredients: number;
  servings?: number;
  likes?: number;
}

export interface SuggestRecipesResult {
  suggestions: RecipeSuggestionExtended[];
  stockIngredientCount: number;
  normalizedIngredients: string[];
  untranslatedIngredients: string[]; // Pour debug/amélioration du dictionnaire
  fromCache: boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class RecipeService {
  private get apiKey(): string {
    const key = process.env.SPOONACULAR_API_KEY;
    if (!key) {
      throw new AppError(
        503,
        'Clé API Spoonacular non configurée. Ajoutez SPOONACULAR_API_KEY dans .env',
      );
    }
    return key;
  }

  /**
   * Suggère des recettes basées sur le stock actuel.
   *
   * Pipeline :
   *   1. Récupère les items en stock (via InventoryService)
   *   2. Normalise FR→EN (via IngredientNormalizer)
   *   3. Vérifie le cache BDD (TTL 24h)
   *   4. Appelle Spoonacular `findByIngredients`
   *   5. Calcule le MatchScore = usedCount / totalCount
   *   6. Trie par score décroissant, filtre missedCount ≤ 3
   *   7. Met en cache + retourne
   */
  async getSuggestedRecipes(): Promise<SuggestRecipesResult> {
    // ── Étape 1 : Stock actuel ────────────────────────────────────────────────
    const stockItems = await inventoryService.getStockIngredients();

    if (stockItems.length === 0) {
      return {
        suggestions: [],
        stockIngredientCount: 0,
        normalizedIngredients: [],
        untranslatedIngredients: [],
        fromCache: false,
      };
    }

    // ── Étape 2 : Normalisation FR→EN ─────────────────────────────────────────
    const normalized = normalizeStockToIngredients(stockItems);
    const ingredientNames = normalized
      .map((n) => n.englishName)
      .slice(0, MAX_INGREDIENTS_TO_SEND);

    const untranslated = normalized
      .filter((n) => !n.wasTranslated)
      .map((n) => n.originalName);

    logger.debug(
      `[Recipes] ${normalized.length} ingrédients normalisés, ${untranslated.length} non traduits`,
    );

    // ── Étape 3 : Cache BDD ───────────────────────────────────────────────────
    ingredientNames.sort();
    const cacheThreshold = new Date(
      Date.now() - RECIPE_CACHE_TTL_HOURS * 60 * 60 * 1000,
    );

    const cachedRecipes = await prisma.recipe.findMany({
      where: { scrapedAt: { gte: cacheThreshold } },
      take: MAX_RECIPES_TO_RETURN,
    });

    if (cachedRecipes.length >= 5) {
      logger.debug(`[Recipes] Cache HIT — ${cachedRecipes.length} recettes depuis BDD`);
      return {
        suggestions: this.buildSuggestionsFromCache(cachedRecipes, normalized),
        stockIngredientCount: stockItems.length,
        normalizedIngredients: ingredientNames,
        untranslatedIngredients: untranslated,
        fromCache: true,
      };
    }

    // ── Étape 4 : Appel Spoonacular ───────────────────────────────────────────
    logger.debug(`[Recipes] Cache MISS — appel Spoonacular avec ${ingredientNames.length} ingrédients`);

    let spoonacularResults: SpoonacularRecipe[];

    try {
      const params = new URLSearchParams({
        ingredients: ingredientNames.join(','),
        number: String(MAX_RECIPES_TO_RETURN),
        ranking: '2', // 2 = maximize used ingredients (vs 1 = minimize missing)
        ignorePantry: 'true', // Ignore sel, eau, huile (considérés toujours dispo)
        apiKey: this.apiKey,
      });

      const response = await fetch(
        `https://api.spoonacular.com/recipes/findByIngredients?${params}`,
        { signal: AbortSignal.timeout(10000) },
      );

      if (response.status === 402) {
        throw new AppError(503, 'Quota Spoonacular dépassé pour aujourd\'hui. Réessayez demain.');
      }

      if (!response.ok) {
        throw new Error(`Spoonacular HTTP ${response.status}`);
      }

      spoonacularResults = await response.json() as SpoonacularRecipe[];
    } catch (err) {
      if (err instanceof AppError) throw err;

      // Fallback sur le cache périmé si disponible
      if (cachedRecipes.length > 0) {
        logger.warn('[Recipes] Spoonacular injoignable — fallback cache périmé');
        return {
          suggestions: this.buildSuggestionsFromCache(cachedRecipes, normalized),
          stockIngredientCount: stockItems.length,
          normalizedIngredients: ingredientNames,
          untranslatedIngredients: untranslated,
          fromCache: true,
        };
      }

      logger.error('[Recipes] Spoonacular injoignable et cache vide', err);
      throw new AppError(503, 'Le moteur de recettes est temporairement indisponible.');
    }

    // ── Étape 5 : Calcul MatchScore + filtrage ────────────────────────────────
    const suggestions = spoonacularResults
      .filter((r) => r.missedIngredientCount <= 3) // Max 3 ingrédients manquants
      .map((r) => this.buildSuggestion(r))
      .sort((a, b) => b.matchScore - a.matchScore);

    // ── Étape 6 : Mise en cache BDD ───────────────────────────────────────────
    await this.cacheRecipes(spoonacularResults);

    return {
      suggestions,
      stockIngredientCount: stockItems.length,
      normalizedIngredients: ingredientNames,
      untranslatedIngredients: untranslated,
      fromCache: false,
    };
  }

  /**
   * Récupère le détail complet d'une recette (avec les étapes).
   * Appelle Spoonacular si la recette n'est pas en cache.
   */
  async getRecipeById(id: string): Promise<SpoonacularRecipeDetail | null> {
    // Les IDs Spoonacular sont numériques, les nôtres sont des UUIDs
    // On cherche dans notre cache via sourceUrl
    const cached = await prisma.recipe.findUnique({ where: { id } });

    if (cached) {
      return cached.steps as unknown as SpoonacularRecipeDetail;
    }

    const spoonacularId = id; // Si l'ID Spoonacular est passé directement

    try {
      const response = await fetch(
        `https://api.spoonacular.com/recipes/${spoonacularId}/information?apiKey=${this.apiKey}`,
        { signal: AbortSignal.timeout(8000) },
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      return await response.json() as SpoonacularRecipeDetail;
    } catch (err) {
      logger.error(`[Recipes] Impossible de charger le détail de la recette ${id}`, err);
      return null;
    }
  }

  // ── Helpers privés ──────────────────────────────────────────────────────────

  private buildSuggestion(r: SpoonacularRecipe): RecipeSuggestionExtended {
    const totalIngredients = r.usedIngredientCount + r.missedIngredientCount;
    const matchScore =
      totalIngredients > 0 ? r.usedIngredientCount / totalIngredients : 0;

    return {
      id: String(r.id),
      title: r.title,
      imageUrl: r.image || null,
      sourceUrl: `https://spoonacular.com/recipes/${r.title.toLowerCase().replace(/\s+/g, '-')}-${r.id}`,
      prepTimeMin: null, // Disponible via l'endpoint /information
      matchScore: Math.round(matchScore * 100) / 100,
      missingIngredients: r.missedIngredients.map((i) => i.name),
      usedIngredients: r.usedIngredients.map((i) => i.name),
      totalIngredients,
      likes: r.likes,
    };
  }

  private buildSuggestionsFromCache(
    recipes: Array<{ id: string; title: string; imageUrl: string | null; sourceUrl: string; ingredients: unknown; prepTimeMin: number | null }>,
    normalized: ReturnType<typeof normalizeStockToIngredients>,
  ): RecipeSuggestionExtended[] {
    const stockEnglishNames = new Set(normalized.map((n) => n.englishName.toLowerCase()));

    return recipes.map((recipe) => {
      const ingredients = recipe.ingredients as Array<{ name: string }>;
      const totalIngredients = ingredients.length;

      const usedIngredients = ingredients
        .filter((ing) => stockEnglishNames.has(ing.name.toLowerCase()))
        .map((ing) => ing.name);

      const missingIngredients = ingredients
        .filter((ing) => !stockEnglishNames.has(ing.name.toLowerCase()))
        .map((ing) => ing.name);

      const matchScore =
        totalIngredients > 0 ? usedIngredients.length / totalIngredients : 0;

      return {
        id: recipe.id,
        title: recipe.title,
        imageUrl: recipe.imageUrl,
        sourceUrl: recipe.sourceUrl,
        prepTimeMin: recipe.prepTimeMin,
        matchScore: Math.round(matchScore * 100) / 100,
        missingIngredients,
        usedIngredients,
        totalIngredients,
      };
    }).sort((a, b) => b.matchScore - a.matchScore);
  }

  private async cacheRecipes(results: SpoonacularRecipe[]): Promise<void> {
    const upserts = results.map((r) =>
      prisma.recipe.upsert({
        where: {
          sourceUrl: `https://spoonacular.com/recipes/${r.id}`,
        },
        update: {
          title: r.title,
          imageUrl: r.image || null,
          ingredients: r.usedIngredients
            .concat(r.missedIngredients)
            .map((i) => ({ name: i.name, amount: i.amount, unit: i.unit })),
          scrapedAt: new Date(),
        },
        create: {
          sourceUrl: `https://spoonacular.com/recipes/${r.id}`,
          title: r.title,
          imageUrl: r.image || null,
          ingredients: r.usedIngredients
            .concat(r.missedIngredients)
            .map((i) => ({ name: i.name, amount: i.amount, unit: i.unit })),
          steps: [],
          scrapedAt: new Date(),
        },
      }),
    );

    await prisma.$transaction(upserts);
    logger.debug(`[Recipes] ${results.length} recettes mises en cache BDD`);
  }
}

export const recipeService = new RecipeService();
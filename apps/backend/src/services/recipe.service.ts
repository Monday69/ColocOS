import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { inventoryService } from './inventory.service';
import { normalizeStockToIngredients, type NormalizedIngredient } from '../utils/ingredientNormalizer';
import { RecipeSuggestion } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Recipe Service
//
// Deux moteurs, un seul contrat de sortie :
//
//   1. SPOONACULAR (si SPOONACULAR_API_KEY est configurée)
//      `findByIngredients` + cache BDD 24 h.
//
//   2. CATALOGUE LOCAL (fallback automatique)
//      Déclenché quand la clé est absente, invalide, ou quand l'API est
//      injoignable / en quota. Aucune erreur 4xx/5xx n'est renvoyée : on génère
//      des suggestions à partir d'un catalogue de recettes du quotidien, en
//      comparant leurs ingrédients au stock réel de la base.
//
// Dans les deux cas, chaque suggestion porte `availableInMeshIds` : les zones
// 3D qui contiennent les ingrédients trouvés, pour l'illumination dans le frigo
// (RecipeModule → setHighlightedMeshIds).
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
  analyzedInstructions: Array<{ steps: Array<{ number: number; step: string }> }>;
  extendedIngredients: Array<{ name: string; amount: number; unit: string; original: string }>;
}

// ── Types internes ────────────────────────────────────────────────────────────

export interface RecipeSuggestionExtended extends RecipeSuggestion {
  usedIngredients: string[];
  /** Ingrédients trouvés, avec la zone 3D qui les contient (si résolue) */
  usedIngredientRefs: Array<{ name: string; meshId: string | null }>;
  totalIngredients: number;
  servings?: number;
  likes?: number;
  readyInMinutes?: number;
}

export type RecipeEngine = 'spoonacular' | 'local';

export interface SuggestRecipesResult {
  suggestions: RecipeSuggestionExtended[];
  stockIngredientCount: number;
  normalizedIngredients: string[];
  untranslatedIngredients: string[]; // Pour debug/amélioration du dictionnaire
  fromCache: boolean;
  /** Moteur réellement utilisé (diagnostic / bandeau UI) */
  engine: RecipeEngine;
  /** Raison du repli local, `null` si Spoonacular a répondu */
  fallbackReason: string | null;
}

type StockEntry = { name: string; meshId: string | null };

// ── Catalogue local ───────────────────────────────────────────────────────────
// Recettes du quotidien, ingrédients en français courant (matching souple :
// accents, pluriels et qualificatifs sont neutralisés).
// Images : Unsplash (libres de droits, URLs vérifiées).

interface CatalogRecipe {
  key: string;
  title: string;
  image: string;
  readyInMinutes: number;
  likes: number;
  ingredients: string[];
}

const LOCAL_CATALOG: CatalogRecipe[] = [
  {
    key: 'riz-saute-soja',
    title: 'Riz sauté à la sauce soja',
    image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=600&q=70',
    readyInMinutes: 20,
    likes: 412,
    ingredients: ['riz', 'sauce soja', 'œuf', 'oignon', 'huile'],
  },
  {
    key: 'pates-carbonara',
    title: 'Pâtes carbonara',
    image: 'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=600&q=70',
    readyInMinutes: 25,
    likes: 890,
    ingredients: ['pâtes', 'lardons', 'œuf', 'parmesan', 'crème'],
  },
  {
    key: 'omelette-herbes',
    title: 'Omelette aux herbes',
    image: 'https://images.unsplash.com/photo-1510693206972-df098062cb71?w=600&q=70',
    readyInMinutes: 12,
    likes: 305,
    ingredients: ['œuf', 'persil', 'ciboulette', 'beurre'],
  },
  {
    key: 'salade-composee',
    title: 'Salade composée',
    image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=70',
    readyInMinutes: 15,
    likes: 521,
    ingredients: ['salade', 'tomate', 'concombre', 'maïs', 'vinaigre'],
  },
  {
    key: 'nouilles-sautees',
    title: 'Nouilles sautées aux légumes',
    image: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=600&q=70',
    readyInMinutes: 20,
    likes: 640,
    ingredients: ['nouilles', 'carotte', 'poivron', 'sauce soja'],
  },
  {
    key: 'gratin-pates',
    title: 'Gratin de pâtes au fromage',
    image: 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=600&q=70',
    readyInMinutes: 35,
    likes: 733,
    ingredients: ['pâtes', 'fromage', 'crème', 'lait'],
  },
  {
    key: 'soupe-legumes',
    title: 'Soupe de légumes maison',
    image: 'https://images.unsplash.com/photo-1476718406336-bb5a9690ee2a?w=600&q=70',
    readyInMinutes: 40,
    likes: 388,
    ingredients: ['carotte', 'pomme de terre', 'poireau', 'oignon', 'bouillon'],
  },
  {
    key: 'poulet-roti',
    title: 'Poulet rôti aux herbes',
    image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=70',
    readyInMinutes: 55,
    likes: 954,
    ingredients: ['poulet', 'thym', 'ail', 'beurre', 'pomme de terre'],
  },
  {
    key: 'croque-monsieur',
    title: 'Croque-monsieur',
    image: 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&q=70',
    readyInMinutes: 15,
    likes: 612,
    ingredients: ['pain', 'jambon', 'fromage', 'beurre'],
  },
  {
    key: 'tomates-mozza',
    title: 'Tomates mozzarella',
    image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&q=70',
    readyInMinutes: 10,
    likes: 445,
    ingredients: ['tomate', 'mozzarella', 'basilic', 'huile olive'],
  },
  {
    key: 'bolognaise',
    title: 'Spaghetti bolognaise',
    image: 'https://images.unsplash.com/photo-1551892374-ecf8754cf8b0?w=600&q=70',
    readyInMinutes: 45,
    likes: 1023,
    ingredients: ['pâtes', 'viande hachée', 'tomate', 'oignon', 'ail'],
  },
  {
    key: 'riz-au-lait',
    title: 'Riz au lait vanillé',
    image: 'https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=600&q=70',
    readyInMinutes: 40,
    likes: 267,
    ingredients: ['riz', 'lait', 'sucre', 'vanille'],
  },
  {
    key: 'wrap-poulet',
    title: 'Wrap au poulet',
    image: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600&q=70',
    readyInMinutes: 18,
    likes: 502,
    ingredients: ['tortilla', 'poulet', 'salade', 'tomate', 'fromage'],
  },
  {
    key: 'porridge-banane',
    title: 'Porridge banane-miel',
    image: 'https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=600&q=70',
    readyInMinutes: 10,
    likes: 331,
    ingredients: ['flocons avoine', 'lait', 'banane', 'miel'],
  },
  {
    key: 'tartines-chevre',
    title: 'Tartines chèvre-miel',
    image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&q=70',
    readyInMinutes: 12,
    likes: 289,
    ingredients: ['pain', 'fromage chèvre', 'miel', 'noix'],
  },
];

// ── Matching souple des ingrédients ───────────────────────────────────────────

/** Minuscules, sans accents, sans ponctuation, pluriels neutralisés. */
function normalizeLabel(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTokens(label: string): string[] {
  return normalizeLabel(label)
    .split(' ')
    .filter(Boolean)
    .map((word) => word.replace(/s$/, ''));
}

/**
 * Un ingrédient requis est « disponible » si tous ses mots se retrouvent dans
 * le nom d'un item en stock (ex. « sauce soja » ⊂ « Sauce soja Kikkoman »,
 * « pâtes » ⊂ « Pâtes penne complètes »).
 */
function findStockMatch(required: string, stock: StockEntry[]): StockEntry | null {
  const requiredTokens = toTokens(required);
  const requiredLabel = requiredTokens.join(' ');
  if (requiredTokens.length === 0) return null;

  // 1. Correspondance stricte des mots-clés
  for (const entry of stock) {
    const stockTokens = toTokens(entry.name);
    if (requiredTokens.every((token) => stockTokens.includes(token))) return entry;
  }

  // 2. Repli : inclusion de chaîne normalisée (gère « flocons avoine » vs
  //    « Flocons d'avoine », où la préposition casse le découpage)
  for (const entry of stock) {
    const stockLabel = toTokens(entry.name).join(' ');
    if (stockLabel.includes(requiredLabel)) return entry;
  }

  return null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class RecipeService {
  private get apiKey(): string | null {
    const key = process.env.SPOONACULAR_API_KEY?.trim();
    return key ? key : null;
  }

  /**
   * Suggère des recettes basées sur le stock actuel.
   *
   * Ne lève jamais d'erreur pour cause de configuration manquante : sans clé
   * Spoonacular (ou en cas d'échec réseau/quota), le catalogue local prend le
   * relais avec le même format de réponse.
   */
  async getSuggestedRecipes(): Promise<SuggestRecipesResult> {
    const stock = await this.getStockWithMeshIds();
    const stockItems = await inventoryService.getStockIngredients();
    const normalized = normalizeStockToIngredients(stockItems);
    const untranslated = normalized.filter((n) => !n.wasTranslated).map((n) => n.originalName);

    // ── 1. Pas de clé → moteur local ─────────────────────────────────────────
    if (!this.apiKey) {
      logger.debug('[Recipes] SPOONACULAR_API_KEY absente → catalogue local');
      return this.buildLocalResult(stock, 'Clé Spoonacular non configurée — catalogue local activé');
    }

    // ── 2. Spoonacular + cache ───────────────────────────────────────────────
    const ingredientNames = normalized
      .map((n) => n.englishName)
      .slice(0, MAX_INGREDIENTS_TO_SEND)
      .sort();

    const meshIdsByEnglishName = this.buildMeshIdsByEnglishName(normalized, stock);

    const cacheThreshold = new Date(Date.now() - RECIPE_CACHE_TTL_HOURS * 60 * 60 * 1000);
    const cachedRecipes = await prisma.recipe.findMany({
      where: { scrapedAt: { gte: cacheThreshold } },
      take: MAX_RECIPES_TO_RETURN,
    });

    if (cachedRecipes.length >= 5) {
      logger.debug(`[Recipes] Cache HIT — ${cachedRecipes.length} recettes depuis BDD`);
      return {
        suggestions: this.buildSuggestionsFromCache(cachedRecipes, normalized, meshIdsByEnglishName),
        stockIngredientCount: stockItems.length,
        normalizedIngredients: ingredientNames,
        untranslatedIngredients: untranslated,
        fromCache: true,
        engine: 'spoonacular',
        fallbackReason: null,
      };
    }

    try {
      const recipes = await this.fetchSpoonacular(ingredientNames);

      const suggestions = recipes
        .filter((r) => r.missedIngredientCount <= 3)
        .map((r) => this.buildSuggestion(r, meshIdsByEnglishName))
        .sort((a, b) => b.matchScore - a.matchScore);

      await this.cacheRecipes(recipes);

      return {
        suggestions,
        stockIngredientCount: stockItems.length,
        normalizedIngredients: ingredientNames,
        untranslatedIngredients: untranslated,
        fromCache: false,
        engine: 'spoonacular',
        fallbackReason: null,
      };
    } catch (err) {
      // ── 3. Échec API → cache périmé, sinon catalogue local ─────────────────
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(`[Recipes] Spoonacular indisponible (${reason}) → repli`);

      if (cachedRecipes.length > 0) {
        return {
          suggestions: this.buildSuggestionsFromCache(cachedRecipes, normalized, meshIdsByEnglishName),
          stockIngredientCount: stockItems.length,
          normalizedIngredients: ingredientNames,
          untranslatedIngredients: untranslated,
          fromCache: true,
          engine: 'spoonacular',
          fallbackReason: `Cache périmé utilisé (${reason})`,
        };
      }

      const local = this.buildLocalResult(stock, reason);
      return { ...local, normalizedIngredients: ingredientNames, untranslatedIngredients: untranslated };
    }
  }

  /**
   * Détail d'une recette.
   * - id du cache BDD → renvoyé tel quel
   * - id `local:*` → reconstruit depuis le catalogue
   * - id Spoonacular → appel API (si clé), sinon null
   */
  async getRecipeById(id: string): Promise<SpoonacularRecipeDetail | null> {
    const cached = await prisma.recipe.findUnique({ where: { id } });
    if (cached) {
      return cached.steps as unknown as SpoonacularRecipeDetail;
    }

    if (id.startsWith('local:')) {
      const key = id.slice('local:'.length);
      const recipe = LOCAL_CATALOG.find((r) => r.key === key);
      if (!recipe) return null;
      return {
        id: Number.NaN,
        title: recipe.title,
        image: recipe.image,
        sourceUrl: this.localSourceUrl(recipe.title),
        readyInMinutes: recipe.readyInMinutes,
        servings: 2,
        summary: `Recette du catalogue local ColocOS (${recipe.ingredients.length} ingrédients).`,
        instructions: '',
        analyzedInstructions: [],
        extendedIngredients: recipe.ingredients.map((name) => ({
          name,
          amount: 1,
          unit: '',
          original: name,
        })),
      };
    }

    const key = this.apiKey;
    if (!key) return null;

    try {
      const response = await fetch(
        `https://api.spoonacular.com/recipes/${id}/information?apiKey=${key}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as SpoonacularRecipeDetail;
    } catch (err) {
      logger.error(`[Recipes] Impossible de charger le détail de la recette ${id}`, err);
      return null;
    }
  }

  // ── Spoonacular ───────────────────────────────────────────────────────────

  private async fetchSpoonacular(ingredientNames: string[]): Promise<SpoonacularRecipe[]> {
    const key = this.apiKey;
    if (!key) throw new Error('SPOONACULAR_API_KEY absente');

    const params = new URLSearchParams({
      ingredients: ingredientNames.join(','),
      number: String(MAX_RECIPES_TO_RETURN),
      ranking: '2', // maximise les ingrédients disponibles
      ignorePantry: 'true',
      apiKey: key,
    });

    const response = await fetch(
      `https://api.spoonacular.com/recipes/findByIngredients?${params}`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (response.status === 402) {
      throw new Error('Quota Spoonacular dépassé');
    }
    if (!response.ok) {
      throw new Error(`Spoonacular HTTP ${response.status}`);
    }

    return (await response.json()) as SpoonacularRecipe[];
  }

  private buildSuggestion(
    r: SpoonacularRecipe,
    meshIdsByEnglishName: Map<string, string[]>,
  ): RecipeSuggestionExtended {
    const totalIngredients = r.usedIngredientCount + r.missedIngredientCount;
    const matchScore = totalIngredients > 0 ? r.usedIngredientCount / totalIngredients : 0;

    const usedIngredientRefs = r.usedIngredients.map((ingredient) => ({
      name: ingredient.name,
      meshId: meshIdsByEnglishName.get(ingredient.name.toLowerCase())?.[0] ?? null,
    }));

    return {
      id: String(r.id),
      title: r.title,
      imageUrl: r.image || null,
      sourceUrl: `https://spoonacular.com/recipes/${r.title.toLowerCase().replace(/\s+/g, '-')}-${r.id}`,
      prepTimeMin: null,
      matchScore: Math.round(matchScore * 100) / 100,
      missingIngredients: r.missedIngredients.map((i) => i.name),
      usedIngredients: r.usedIngredients.map((i) => i.name),
      usedIngredientRefs,
      totalIngredients,
      likes: r.likes,
      availableInMeshIds: this.uniqueMeshIds(usedIngredientRefs.map((ref) => ref.meshId)),
    };
  }

  private buildSuggestionsFromCache(
    recipes: Array<{
      id: string;
      title: string;
      imageUrl: string | null;
      sourceUrl: string;
      ingredients: unknown;
      prepTimeMin: number | null;
    }>,
    normalized: NormalizedIngredient[],
    meshIdsByEnglishName: Map<string, string[]>,
  ): RecipeSuggestionExtended[] {
    const stockEnglishNames = new Set(normalized.map((n) => n.englishName.toLowerCase()));

    return recipes
      .map((recipe) => {
        const ingredients = (recipe.ingredients as Array<{ name: string }>) ?? [];
        const totalIngredients = ingredients.length;

        const used = ingredients.filter((ing) => stockEnglishNames.has(ing.name.toLowerCase()));
        const missing = ingredients.filter((ing) => !stockEnglishNames.has(ing.name.toLowerCase()));

        const usedIngredientRefs = used.map((ing) => ({
          name: ing.name,
          meshId: meshIdsByEnglishName.get(ing.name.toLowerCase())?.[0] ?? null,
        }));

        const matchScore = totalIngredients > 0 ? used.length / totalIngredients : 0;

        return {
          id: recipe.id,
          title: recipe.title,
          imageUrl: recipe.imageUrl,
          sourceUrl: recipe.sourceUrl,
          prepTimeMin: recipe.prepTimeMin,
          matchScore: Math.round(matchScore * 100) / 100,
          missingIngredients: missing.map((ing) => ing.name),
          usedIngredients: used.map((ing) => ing.name),
          usedIngredientRefs,
          totalIngredients,
          availableInMeshIds: this.uniqueMeshIds(usedIngredientRefs.map((ref) => ref.meshId)),
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore);
  }

  private async cacheRecipes(results: SpoonacularRecipe[]): Promise<void> {
    if (results.length === 0) return;

    const upserts = results.map((r) =>
      prisma.recipe.upsert({
        where: { sourceUrl: `https://spoonacular.com/recipes/${r.id}` },
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

  // ── Catalogue local ───────────────────────────────────────────────────────

  private buildLocalResult(stock: StockEntry[], fallbackReason: string): SuggestRecipesResult {
    const suggestions = LOCAL_CATALOG.map((recipe) => {
      const used: Array<{ name: string; meshId: string | null }> = [];
      const missed: string[] = [];

      for (const ingredient of recipe.ingredients) {
        const match = findStockMatch(ingredient, stock);
        if (match) used.push({ name: match.name, meshId: match.meshId });
        else missed.push(ingredient);
      }

      const totalIngredients = recipe.ingredients.length;
      const matchScore = totalIngredients > 0 ? used.length / totalIngredients : 0;

      return {
        id: `local:${recipe.key}`,
        title: recipe.title,
        imageUrl: recipe.image,
        sourceUrl: this.localSourceUrl(recipe.title),
        prepTimeMin: recipe.readyInMinutes,
        readyInMinutes: recipe.readyInMinutes,
        matchScore: Math.round(matchScore * 100) / 100,
        missingIngredients: missed,
        usedIngredients: used.map((u) => u.name),
        usedIngredientRefs: used,
        totalIngredients,
        likes: recipe.likes,
        availableInMeshIds: this.uniqueMeshIds(used.map((u) => u.meshId)),
      };
    })
      // Recettes réalisables tout de suite d'abord, puis le moins de manques
      .sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return a.missingIngredients.length - b.missingIngredients.length;
      })
      .slice(0, MAX_RECIPES_TO_RETURN);

    const readyCount = suggestions.filter((s) => s.missingIngredients.length === 0).length;
    logger.debug(
      `[Recipes] Catalogue local : ${suggestions.length} suggestions (${readyCount} prêtes) sur ${stock.length} ingrédients en stock`,
    );

    return {
      suggestions,
      stockIngredientCount: stock.length,
      normalizedIngredients: stock.map((s) => s.name),
      untranslatedIngredients: [],
      fromCache: false,
      engine: 'local',
      fallbackReason,
    };
  }

  /** URL de repli pour le lien « voir la recette » du catalogue local. */
  private localSourceUrl(title: string): string {
    return `https://www.marmiton.org/recettes/recherche.aspx?aqt=${encodeURIComponent(title)}`;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Items en stock avec le meshId de leur zone (pour l'illumination 3D). */
  private async getStockWithMeshIds(): Promise<StockEntry[]> {
    const rows = await prisma.item.findMany({
      where: { quantity: { gt: 0 } },
      select: { name: true, storageZone: { select: { meshId: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const byName = new Map<string, string | null>();
    for (const row of rows) {
      if (!byName.has(row.name)) byName.set(row.name, row.storageZone?.meshId ?? null);
    }

    return Array.from(byName, ([name, meshId]) => ({ name, meshId }));
  }

  /** englishName (normalisé) → meshIds des zones qui contiennent l'ingrédient. */
  private buildMeshIdsByEnglishName(
    normalized: NormalizedIngredient[],
    stock: StockEntry[],
  ): Map<string, string[]> {
    const meshIdByOriginalName = new Map(stock.map((entry) => [entry.name, entry.meshId]));
    const result = new Map<string, string[]>();

    for (const entry of normalized) {
      const meshId = meshIdByOriginalName.get(entry.originalName) ?? null;
      if (!meshId) continue;
      const key = entry.englishName.toLowerCase();
      const current = result.get(key) ?? [];
      if (!current.includes(meshId)) current.push(meshId);
      result.set(key, current);
    }

    return result;
  }

  private uniqueMeshIds(meshIds: Array<string | null>): string[] {
    return Array.from(new Set(meshIds.filter((id): id is string => Boolean(id))));
  }
}

export const recipeService = new RecipeService();
export { LOCAL_CATALOG };
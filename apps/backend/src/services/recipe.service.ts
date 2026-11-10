import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/errorHandler';
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
  /** Protéines estimées par portion (g), null si inconnues (moteur Spoonacular) */
  proteinGrams?: number | null;
  /**
   * Sprint 4 — enrichissements du hub Recettes.
   * Optionnels au niveau des builders (avant la couche utilisateur), toujours
   * renseignés par `applyUserLayer` dans la réponse HTTP.
   */
  isFavorite?: boolean;
  isFullyAvailable?: boolean;
  isAlmostAvailable?: boolean;
  missingIngredientCount?: number;
  /** Bloc 1 — recette personnalisée (importée ou saisie) */
  isCustom?: boolean;
  /** Bloc 1 — colocataires ayant mis la recette en favori */
  favoritedByUsers?: Array<{ id: string; name: string; colorHex: string }>;
  /** Bloc 1 — au moins deux colocataires différents l'ont validée */
  isColocMatch?: boolean;
}

export interface CustomIngredient {
  name: string;
  quantity?: number | null;
  unit?: string | null;
}

export interface CustomRecipeSummary {
  id: string;
  title: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  servings: number;
  instructions: string[];
  ingredients: CustomIngredient[];
  createdAt: string;
  createdBy: { id: string; name: string; colorHex: string };
}

export interface CreateCustomRecipeInput {
  title: string;
  sourceUrl?: string | null;
  imageUrl?: string | null;
  prepTimeMin?: number | null;
  cookTimeMin?: number | null;
  servings?: number;
  instructions: string[];
  ingredients: CustomIngredient[];
}

/** Filtres avancés du hub Recettes. */
export interface RecipeFilters {
  search?: string;
  maxTime?: number;
  minProtein?: number;
  onlyAvailable?: boolean;
  onlyAlmost?: boolean;
  onlyFavorites?: boolean;
  limit?: number;
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
  /** Protéines estimées par portion (g) — alimente le filtre « Riche en protéines » */
  proteinGrams: number;
  ingredients: string[];
}

const LOCAL_CATALOG: CatalogRecipe[] = [
  {
    key: 'riz-saute-soja',
    title: 'Riz sauté à la sauce soja',
    image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=600&q=70',
    readyInMinutes: 20,
    likes: 412,
    proteinGrams: 18,
    ingredients: ['riz', 'sauce soja', 'œuf', 'oignon', 'huile'],
  },
  {
    key: 'pates-carbonara',
    title: 'Pâtes carbonara',
    image: 'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=600&q=70',
    readyInMinutes: 25,
    likes: 890,
    proteinGrams: 28,
    ingredients: ['pâtes', 'lardons', 'œuf', 'parmesan', 'crème'],
  },
  {
    key: 'omelette-herbes',
    title: 'Omelette aux herbes',
    image: 'https://images.unsplash.com/photo-1510693206972-df098062cb71?w=600&q=70',
    readyInMinutes: 12,
    likes: 305,
    proteinGrams: 22,
    ingredients: ['œuf', 'persil', 'ciboulette', 'beurre'],
  },
  {
    key: 'salade-composee',
    title: 'Salade composée',
    image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=70',
    readyInMinutes: 15,
    likes: 521,
    proteinGrams: 8,
    ingredients: ['salade', 'tomate', 'concombre', 'maïs', 'vinaigre'],
  },
  {
    key: 'nouilles-sautees',
    title: 'Nouilles sautées aux légumes',
    image: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=600&q=70',
    readyInMinutes: 20,
    likes: 640,
    proteinGrams: 14,
    ingredients: ['nouilles', 'carotte', 'poivron', 'sauce soja'],
  },
  {
    key: 'gratin-pates',
    title: 'Gratin de pâtes au fromage',
    image: 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=600&q=70',
    readyInMinutes: 35,
    likes: 733,
    proteinGrams: 24,
    ingredients: ['pâtes', 'fromage', 'crème', 'lait'],
  },
  {
    key: 'soupe-legumes',
    title: 'Soupe de légumes maison',
    image: 'https://images.unsplash.com/photo-1476718406336-bb5a9690ee2a?w=600&q=70',
    readyInMinutes: 40,
    likes: 388,
    proteinGrams: 5,
    ingredients: ['carotte', 'pomme de terre', 'poireau', 'oignon', 'bouillon'],
  },
  {
    key: 'poulet-roti',
    title: 'Poulet rôti aux herbes',
    image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=70',
    readyInMinutes: 55,
    likes: 954,
    proteinGrams: 42,
    ingredients: ['poulet', 'thym', 'ail', 'beurre', 'pomme de terre'],
  },
  {
    key: 'croque-monsieur',
    title: 'Croque-monsieur',
    image: 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&q=70',
    readyInMinutes: 15,
    likes: 612,
    proteinGrams: 22,
    ingredients: ['pain', 'jambon', 'fromage', 'beurre'],
  },
  {
    key: 'tomates-mozza',
    title: 'Tomates mozzarella',
    image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&q=70',
    readyInMinutes: 10,
    likes: 445,
    proteinGrams: 18,
    ingredients: ['tomate', 'mozzarella', 'basilic', 'huile olive'],
  },
  {
    key: 'bolognaise',
    title: 'Spaghetti bolognaise',
    image: 'https://images.unsplash.com/photo-1551892374-ecf8754cf8b0?w=600&q=70',
    readyInMinutes: 45,
    likes: 1023,
    proteinGrams: 32,
    ingredients: ['pâtes', 'viande hachée', 'tomate', 'oignon', 'ail'],
  },
  {
    key: 'riz-au-lait',
    title: 'Riz au lait vanillé',
    image: 'https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=600&q=70',
    readyInMinutes: 40,
    likes: 267,
    proteinGrams: 8,
    ingredients: ['riz', 'lait', 'sucre', 'vanille'],
  },
  {
    key: 'wrap-poulet',
    title: 'Wrap au poulet',
    image: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600&q=70',
    readyInMinutes: 18,
    likes: 502,
    proteinGrams: 30,
    ingredients: ['tortilla', 'poulet', 'salade', 'tomate', 'fromage'],
  },
  {
    key: 'porridge-banane',
    title: 'Porridge banane-miel',
    image: 'https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=600&q=70',
    readyInMinutes: 10,
    likes: 331,
    proteinGrams: 12,
    ingredients: ['flocons avoine', 'lait', 'banane', 'miel'],
  },
  {
    key: 'tartines-chevre',
    title: 'Tartines chèvre-miel',
    image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&q=70',
    readyInMinutes: 12,
    likes: 289,
    proteinGrams: 16,
    ingredients: ['pain', 'fromage chèvre', 'miel', 'noix'],
  },
];

// ── Matching souple des ingrédients ───────────────────────────────────────────

/** Minuscules, sans accents, sans ponctuation, pluriels neutralisés. */
function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

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

  /**
   * Garde-fou pour les mots très courts (« sel », « riz », « ail ») : un token
   * unique de ≤ 4 lettres ne doit matcher que s'il ouvre le libellé du stock
   * ou le compose entièrement. Sinon « sel » validerait
   * « Sauce soja teneur réduite en sel » — faux positif constaté à l'import.
   */
  const strictHead = requiredTokens.length === 1 && requiredLabel.length <= 4;

  // 1. Correspondance stricte des mots-clés
  for (const entry of stock) {
    const stockTokens = toTokens(entry.name);
    if (!requiredTokens.every((token) => stockTokens.includes(token))) continue;
    if (strictHead && stockTokens[0] !== requiredLabel) continue;
    return entry;
  }

  // 2. Repli : inclusion de chaîne normalisée (gère « flocons avoine » vs
  //    « Flocons d'avoine », où la préposition casse le découpage)
  if (!strictHead) {
    for (const entry of stock) {
      const stockLabel = toTokens(entry.name).join(' ');
      if (stockLabel.includes(requiredLabel)) return entry;
    }
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
  // ── Recettes personnalisées (Bloc 1) ───────────────────────────────────────

  /** Recettes personnalisées de la coloc, du plus récent au plus ancien. */
  async listCustomRecipes(): Promise<CustomRecipeSummary[]> {
    const rows = await prisma.customRecipe.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true, colorHex: true } } },
    });

    return rows.map((row) => this.toCustomSummary(row));
  }

  /** Enregistre une recette importée (JSON-LD) ou saisie manuellement. */
  async createCustomRecipe(
    userId: string,
    input: CreateCustomRecipeInput,
  ): Promise<CustomRecipeSummary> {
    const title = input.title.trim();
    if (!title) throw new AppError(400, 'Le titre de la recette est requis.');

    const ingredients = input.ingredients
      .map((ingredient) => ({
        name: ingredient.name.trim(),
        quantity: ingredient.quantity ?? null,
        unit: ingredient.unit ?? null,
      }))
      .filter((ingredient) => ingredient.name.length > 0);

    if (ingredients.length === 0) {
      throw new AppError(400, 'Au moins un ingrédient est requis.');
    }

    const instructions = input.instructions
      .map((step) => step.trim())
      .filter((step) => step.length > 0);

    const created = await prisma.customRecipe.create({
      data: {
        title: title.slice(0, 200),
        sourceUrl: input.sourceUrl?.slice(0, 500) ?? null,
        imageUrl: input.imageUrl?.slice(0, 500) ?? null,
        prepTimeMin: input.prepTimeMin ?? null,
        cookTimeMin: input.cookTimeMin ?? null,
        servings: input.servings ?? 4,
        instructions,
        ingredients,
        createdById: userId,
      },
      include: { createdBy: { select: { id: true, name: true, colorHex: true } } },
    });

    logger.info(`[Recipes] Recette personnalisée créée : ${created.title} (${ingredients.length} ingrédients)`);

    return this.toCustomSummary(created);
  }

  /** Supprime une recette personnalisée (créateur uniquement). */
  async deleteCustomRecipe(id: string, userId: string): Promise<{ deleted: boolean }> {
    const existing = await prisma.customRecipe.findUnique({
      where: { id },
      select: { id: true, createdById: true, title: true },
    });

    if (!existing) throw new AppError(404, `Recette introuvable : ${id}`);
    if (existing.createdById !== userId) {
      throw new AppError(403, 'Seul le créateur peut supprimer cette recette.');
    }

    await prisma.customRecipe.delete({ where: { id } });
    logger.info(`[Recipes] Recette personnalisée supprimée : ${existing.title}`);

    return { deleted: true };
  }

  private toCustomSummary(row: {
    id: string;
    title: string;
    sourceUrl: string | null;
    imageUrl: string | null;
    prepTimeMin: number | null;
    cookTimeMin: number | null;
    servings: number;
    instructions: unknown;
    ingredients: unknown;
    createdAt: Date;
    createdBy: { id: string; name: string; colorHex: string };
  }): CustomRecipeSummary {
    return {
      id: row.id,
      title: row.title,
      sourceUrl: row.sourceUrl,
      imageUrl: row.imageUrl,
      prepTimeMin: row.prepTimeMin,
      cookTimeMin: row.cookTimeMin,
      servings: row.servings,
      instructions: Array.isArray(row.instructions) ? (row.instructions as string[]) : [],
      ingredients: Array.isArray(row.ingredients)
        ? (row.ingredients as CustomIngredient[])
        : [],
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
    };
  }

  /**
   * Convertit une recette personnalisée en suggestion du hub : le matching
   * ingrédients ↔ stock utilise le même moteur que le catalogue local.
   */
  private customToSuggestion(
    row: {
      id: string;
      title: string;
      sourceUrl: string | null;
      imageUrl: string | null;
      prepTimeMin: number | null;
      cookTimeMin: number | null;
      ingredients: unknown;
    },
    stock: StockEntry[],
  ): RecipeSuggestionExtended | null {
    const rawIngredients = Array.isArray(row.ingredients)
      ? (row.ingredients as CustomIngredient[])
      : [];
    const names = rawIngredients
      .map((ingredient) => (typeof ingredient?.name === 'string' ? ingredient.name.trim() : ''))
      .filter((name) => name.length > 0);

    if (names.length === 0) return null;

    const used: Array<{ name: string; meshId: string | null }> = [];
    const missed: string[] = [];

    for (const name of names) {
      const match = findStockMatch(name, stock);
      if (match) used.push({ name: match.name, meshId: match.meshId });
      else missed.push(name);
    }

    const totalIngredients = names.length;
    const matchScore = totalIngredients > 0 ? used.length / totalIngredients : 0;
    const totalTime =
      row.prepTimeMin !== null || row.cookTimeMin !== null
        ? (row.prepTimeMin ?? 0) + (row.cookTimeMin ?? 0)
        : null;

    return {
      id: `custom:${row.id}`,
      title: row.title,
      imageUrl: row.imageUrl,
      sourceUrl: row.sourceUrl ?? '',
      prepTimeMin: totalTime,
      readyInMinutes: totalTime ?? undefined,
      matchScore: Math.round(matchScore * 100) / 100,
      missingIngredients: missed,
      usedIngredients: used.map((entry) => entry.name),
      usedIngredientRefs: used,
      totalIngredients,
      likes: 0,
      proteinGrams: null,
      availableInMeshIds: this.uniqueMeshIds(used.map((entry) => entry.meshId)),
      isCustom: true,
    };
  }

  /**
   * Suggestions enrichies pour le hub Recettes (Sprint 4) :
   * favoris du colocataire connecté, faisabilité et filtres avancés.
   */
  async getSuggestedRecipes(
    options: { userId?: string; filters?: RecipeFilters } = {},
  ): Promise<SuggestRecipesResult> {
    const base = await this.computeSuggestions();
    // Bloc 1 : les recettes personnalisées de la coloc rejoignent le hub
    const customRows = await prisma.customRecipe.findMany({
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    const merged =
      customRows.length > 0
        ? this.withCustomRecipes(base, customRows, await this.getStockWithMeshIds())
        : base;

    return this.applyUserLayer(merged, options.userId, options.filters);
  }

  /** Identifiants des recettes favorites d'un utilisateur. */
  async getFavoriteRecipeIds(userId: string): Promise<Set<string>> {
    const rows = await prisma.favoriteRecipe.findMany({
      where: { userId },
      select: { recipeId: true },
    });
    return new Set(rows.map((row) => row.recipeId));
  }

  /** Ajoute ou retire une recette des favoris (idempotent). */
  async toggleFavorite(userId: string, recipeId: string): Promise<{ isFavorite: boolean }> {
    const trimmed = recipeId.trim();
    if (!trimmed) throw new AppError(400, 'Identifiant de recette requis.');

    const existing = await prisma.favoriteRecipe.findUnique({
      where: { userId_recipeId: { userId, recipeId: trimmed } },
    });

    if (existing) {
      await prisma.favoriteRecipe.delete({ where: { id: existing.id } });
      return { isFavorite: false };
    }

    await prisma.favoriteRecipe.create({ data: { userId, recipeId: trimmed } });
    return { isFavorite: true };
  }

  /** Ajoute les recettes personnalisées aux suggestions (Bloc 1). */
  private withCustomRecipes(
    result: SuggestRecipesResult,
    customRows: Array<{
      id: string;
      title: string;
      sourceUrl: string | null;
      imageUrl: string | null;
      prepTimeMin: number | null;
      cookTimeMin: number | null;
      ingredients: unknown;
    }>,
    stock: StockEntry[],
  ): SuggestRecipesResult {
    if (customRows.length === 0) return result;

    const customSuggestions = customRows
      .map((row) => this.customToSuggestion(row, stock))
      .filter((entry): entry is RecipeSuggestionExtended => entry !== null);

    return {
      ...result,
      suggestions: [...customSuggestions, ...result.suggestions],
    };
  }

  /**
   * Couche « utilisateur » : favoris, faisabilité, filtres et tri intelligent
   * (100 % réalisable → à 1 ingrédient près → le reste).
   */
  private async applyUserLayer(
    result: SuggestRecipesResult,
    userId?: string,
    filters?: RecipeFilters,
  ): Promise<SuggestRecipesResult> {
    const favoriteIds = userId ? await this.getFavoriteRecipeIds(userId) : new Set<string>();

    // Bloc 1 — qui a validé quoi (badge « Match Coloc »)
    const favoriteRows = await prisma.favoriteRecipe.findMany({
      select: {
        recipeId: true,
        user: { select: { id: true, name: true, colorHex: true } },
      },
    });
    const favoritedByRecipe = new Map<string, Array<{ id: string; name: string; colorHex: string }>>();
    for (const row of favoriteRows) {
      const list = favoritedByRecipe.get(row.recipeId) ?? [];
      list.push(row.user);
      favoritedByRecipe.set(row.recipeId, list);
    }
    // Recherche insensible à la casse ET aux accents (« pates » trouve « Pâtes »)
    const search = filters?.search ? stripDiacritics(filters.search.trim().toLowerCase()) : undefined;

    let suggestions: RecipeSuggestionExtended[] = result.suggestions.map((suggestion) => {
      const missing = suggestion.missingIngredients.length;
      const favoritedByUsers = favoritedByRecipe.get(suggestion.id) ?? [];
      return {
        ...suggestion,
        isFavorite: favoriteIds.has(suggestion.id),
        isFullyAvailable: missing === 0,
        isAlmostAvailable: missing === 1,
        missingIngredientCount: missing,
        favoritedByUsers,
        isColocMatch: favoritedByUsers.length >= 2,
      };
    });

    if (search) {
      suggestions = suggestions.filter((suggestion) => {
        if (stripDiacritics(suggestion.title.toLowerCase()).includes(search)) return true;
        const inMissing = suggestion.missingIngredients.some((ingredient) =>
          stripDiacritics(ingredient.toLowerCase()).includes(search),
        );
        const inUsed = suggestion.usedIngredients.some((ingredient) =>
          stripDiacritics(ingredient.toLowerCase()).includes(search),
        );
        return inMissing || inUsed;
      });
    }

    if (filters?.maxTime !== undefined) {
      const maxTime = filters.maxTime;
      suggestions = suggestions.filter(
        (suggestion) => (suggestion.readyInMinutes ?? Number.POSITIVE_INFINITY) <= maxTime,
      );
    }

    if (filters?.minProtein !== undefined) {
      const minProtein = filters.minProtein;
      suggestions = suggestions.filter(
        (suggestion) => (suggestion.proteinGrams ?? 0) >= minProtein,
      );
    }

    if (filters?.onlyAvailable) {
      suggestions = suggestions.filter((suggestion) => suggestion.isFullyAvailable);
    }

    if (filters?.onlyAlmost) {
      suggestions = suggestions.filter((suggestion) => suggestion.isAlmostAvailable);
    }

    if (filters?.onlyFavorites) {
      suggestions = suggestions.filter((suggestion) => suggestion.isFavorite);
    }

    // Tri : faisables → à 1 ingrédient près → autres, puis score de match
    suggestions.sort((a, b) => {
      // Les recettes validées par la coloc remontent en tête
      if (!!b.isColocMatch !== !!a.isColocMatch) return b.isColocMatch ? 1 : -1;
      const rank = (value: RecipeSuggestionExtended) =>
        value.isFullyAvailable ? 0 : value.isAlmostAvailable ? 1 : 2;
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return (b.missingIngredientCount ?? 0) - (a.missingIngredientCount ?? 0);
    });

    return {
      ...result,
      suggestions: suggestions.slice(0, filters?.limit ?? MAX_RECIPES_TO_RETURN),
    };
  }

  private async computeSuggestions(): Promise<SuggestRecipesResult> {
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
        proteinGrams: recipe.proteinGrams,
        availableInMeshIds: this.uniqueMeshIds(used.map((u) => u.meshId)),
      };
    })
      // Recettes réalisables tout de suite d'abord, puis le moins de manques
      .sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return a.missingIngredients.length - b.missingIngredients.length;
      });
    // Le découpage final se fait après filtrage (applyUserLayer)

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

  /**
   * Bloc 1 — marque chaque ingrédient importé comme présent/absent du stock.
   * Utilisé par l'aperçu de la modale d'import (pastilles vertes / ambre).
   */
  async annotateStockStatus(
    ingredients: Array<{ name: string; quantity?: number | null; unit?: string | null }>,
  ): Promise<
    Array<{
      name: string;
      quantity: number | null;
      unit: string | null;
      inStock: boolean;
      matchedName: string | null;
    }>
  > {
    const stock = await this.getStockWithMeshIds();

    return ingredients.map((ingredient) => {
      const match = findStockMatch(ingredient.name, stock);
      return {
        name: ingredient.name,
        quantity: ingredient.quantity ?? null,
        unit: ingredient.unit ?? null,
        inStock: match !== null,
        matchedName: match?.name ?? null,
      };
    });
  }

  /** Items en stock avec le meshId de leur zone (pour l'illumination 3D). */
  private async getStockWithMeshIds(): Promise<StockEntry[]> {
    const rows = await prisma.item.findMany({
      where: { quantity: { gt: 0 }, consumedAt: null },
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
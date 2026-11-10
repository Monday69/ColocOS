import { Request, Response, NextFunction } from 'express';
import { recipeService } from '../services/recipe.service';
import { ApiResponse } from '../types';
import { AppError } from '../middlewares/errorHandler';
import type { RecipeFilters } from '../services/recipe.service';
import { recipeScraperService } from '../services/recipeScraper.service';
import { z } from 'zod';

// ── Bloc 1 : validation des entrées ──────────────────────────────────────────

const ExtractUrlSchema = z.object({
  url: z.string().trim().min(8, 'URL requise').max(500),
});

const CustomIngredientSchema = z.object({
  name: z.string().trim().min(1, "Nom d'ingrédient requis").max(160),
  quantity: z.number().nonnegative().max(99999).nullish(),
  unit: z.string().trim().max(40).nullish(),
});

const CreateCustomRecipeSchema = z.object({
  title: z.string().trim().min(1, 'Titre requis').max(200),
  sourceUrl: z.string().trim().max(500).nullish(),
  imageUrl: z.string().trim().max(500).nullish(),
  prepTimeMin: z.number().int().min(0).max(1440).nullish(),
  cookTimeMin: z.number().int().min(0).max(1440).nullish(),
  servings: z.number().int().min(1).max(50).optional(),
  instructions: z.array(z.string().trim().max(2000)).max(60).default([]),
  ingredients: z.array(CustomIngredientSchema).min(1, 'Au moins un ingrédient requis').max(80),
});

/** Query string → filtres typés (tout champ absent reste indéfini). */
function parseRecipeFilters(query: Request['query']): RecipeFilters {
  const filters: RecipeFilters = {};
  const { search, maxTime, minProtein, onlyAvailable, onlyAlmost, onlyFavorites, limit } =
    query as Record<string, string | undefined>;

  if (search?.trim()) filters.search = search.trim().slice(0, 80);

  if (maxTime !== undefined && maxTime !== '') {
    const value = Number(maxTime);
    if (!Number.isFinite(value) || value <= 0 || value > 600) {
      throw new AppError(400, 'Paramètre « maxTime » invalide (1–600 minutes).');
    }
    filters.maxTime = Math.round(value);
  }

  if (minProtein !== undefined && minProtein !== '') {
    const value = Number(minProtein);
    if (!Number.isFinite(value) || value < 0 || value > 200) {
      throw new AppError(400, 'Paramètre « minProtein » invalide (0–200 g).');
    }
    filters.minProtein = Math.round(value * 10) / 10;
  }

  if (limit !== undefined && limit !== '') {
    const value = Number(limit);
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      throw new AppError(400, 'Paramètre « limit » invalide (1–100).');
    }
    filters.limit = Math.round(value);
  }

  const flag = (value: string | undefined) => value === 'true' || value === '1';
  if (flag(onlyAvailable)) filters.onlyAvailable = true;
  if (flag(onlyAlmost)) filters.onlyAlmost = true;
  if (flag(onlyFavorites)) filters.onlyFavorites = true;

  return filters;
}

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Recipe Controller
// ─────────────────────────────────────────────────────────────────────────────

export class RecipeController {
  /**
   * GET /api/recipes/suggest
   * Retourne les recettes suggérées basées sur le stock actuel.
   */
  async suggest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters = parseRecipeFilters(req.query);
      const result = await recipeService.getSuggestedRecipes({
        userId: req.user?.id,
        filters,
      });

      res.status(200).json({
        success: true,
        data: {
          suggestions: result.suggestions,
          meta: {
            engine: result.engine,
            fallbackReason: result.fallbackReason,
            stockIngredientCount: result.stockIngredientCount,
            normalizedIngredients: result.normalizedIngredients,
            untranslatedIngredients: result.untranslatedIngredients,
            fromCache: result.fromCache,
            totalSuggestions: result.suggestions.length,
            filters: {
              search: filters?.search ?? null,
              maxTime: filters?.maxTime ?? null,
              minProtein: filters?.minProtein ?? null,
              onlyAvailable: filters?.onlyAvailable ?? false,
              onlyAlmost: filters?.onlyAlmost ?? false,
              onlyFavorites: filters?.onlyFavorites ?? false,
            },
            fullyAvailable: result.suggestions.filter((s) => s.isFullyAvailable).length,
            almostAvailable: result.suggestions.filter((s) => s.isAlmostAvailable).length,
            favorites: result.suggestions.filter((s) => s.isFavorite).length,
          },
        },
        message:
          result.engine === 'local'
            ? `${result.suggestions.length} recettes (catalogue local) basées sur ${result.stockIngredientCount} ingrédients en stock`
            : result.fromCache
              ? `${result.suggestions.length} recettes suggérées (cache)`
              : `${result.suggestions.length} recettes suggérées basées sur ${result.stockIngredientCount} ingrédients en stock`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/recipes/:recipeId/favorite
   * Bascule la recette dans les favoris du colocataire connecté.
   */
  async toggleFavorite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');

      const result = await recipeService.toggleFavorite(req.user.id, req.params.recipeId);

      res.status(200).json({
        success: true,
        data: result,
        message: result.isFavorite ? 'Ajoutée aux favoris' : 'Retirée des favoris',
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/recipes/extract-url
   * Scrape une page (JSON-LD Schema.org) et renvoie une prévisualisation
   * enrichie de l'état du stock — sans rien persister.
   */
  async extractFromUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { url } = ExtractUrlSchema.parse(req.body);
      const scraped = await recipeScraperService.scrapeRecipeFromUrl(url);

      const ingredients = await recipeService.annotateStockStatus(scraped.ingredients);
      const missingCount = ingredients.filter((ingredient) => !ingredient.inStock).length;

      res.status(200).json({
        success: true,
        data: {
          ...scraped,
          ingredients,
          stockSummary: {
            total: ingredients.length,
            inStock: ingredients.length - missingCount,
            missing: missingCount,
          },
        },
        message: `${scraped.title} — ${ingredients.length} ingrédients, ${missingCount} manquant(s)`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/recipes/custom — recettes personnalisées de la coloc. */
  async listCustom(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recipes = await recipeService.listCustomRecipes();

      res.status(200).json({
        success: true,
        data: recipes,
        message: `${recipes.length} recette(s) personnalisée(s)`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/recipes/custom — enregistre une recette importée / saisie. */
  async createCustom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');

      const dto = CreateCustomRecipeSchema.parse(req.body);
      const created = await recipeService.createCustomRecipe(req.user.id, dto);

      res.status(201).json({
        success: true,
        data: created,
        message: `« ${created.title} » ajoutée aux recettes de la coloc`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** DELETE /api/recipes/custom/:id — réservé au créateur. */
  async deleteCustom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');

      const result = await recipeService.deleteCustomRecipe(req.params.id, req.user.id);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Recette supprimée',
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/recipes/:id
   * Détail d'une recette (étapes, ingrédients complets).
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recipe = await recipeService.getRecipeById(req.params.id);

      if (!recipe) {
        res.status(404).json({
          success: false,
          error: `Recette introuvable : ${req.params.id}`,
        });
        return;
      }

      res.status(200).json({ success: true, data: recipe } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
}

export const recipeController = new RecipeController();
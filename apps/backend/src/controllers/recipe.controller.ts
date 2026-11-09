import { Request, Response, NextFunction } from 'express';
import { recipeService } from '../services/recipe.service';
import { ApiResponse } from '../types';
import { AppError } from '../middlewares/errorHandler';
import type { RecipeFilters } from '../services/recipe.service';

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
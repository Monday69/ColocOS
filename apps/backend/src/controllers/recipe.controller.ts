import { Request, Response, NextFunction } from 'express';
import { recipeService } from '../services/recipe.service';
import { ApiResponse } from '../types';

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
      const result = await recipeService.getSuggestedRecipes();

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
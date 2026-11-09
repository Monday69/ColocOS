import { Router } from 'express';
import { recipeController } from '../controllers/recipe.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Recipe Routes
//
// GET  /api/recipes/suggest  → Suggestions basées sur le stock réel
// GET  /api/recipes/:id      → Détail d'une recette
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use(authenticate);

router.get('/suggest', recipeController.suggest.bind(recipeController));
router.post('/:recipeId/favorite', recipeController.toggleFavorite.bind(recipeController));
router.get('/:id', recipeController.getById.bind(recipeController));

export default router;
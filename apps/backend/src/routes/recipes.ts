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

// ── Bloc 1 : import par URL & recettes personnalisées ────────────────────────
// Déclarés avant `/:id` pour que /custom ne soit pas capté comme un identifiant.
router.post('/extract-url', recipeController.extractFromUrl.bind(recipeController));
router.get('/custom', recipeController.listCustom.bind(recipeController));
router.post('/custom', recipeController.createCustom.bind(recipeController));
router.delete('/custom/:id', recipeController.deleteCustom.bind(recipeController));

router.post('/:recipeId/favorite', recipeController.toggleFavorite.bind(recipeController));
router.get('/:id', recipeController.getById.bind(recipeController));

export default router;
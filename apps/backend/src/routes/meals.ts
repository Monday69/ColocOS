import { Router } from 'express';
import { mealController } from '../controllers/meal.controller';
import { authenticateOptional } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Meals Routes (journal nutritionnel)
//
// POST /api/meals            → enregistre un repas (items + totaux calculés)
// GET  /api/meals/today      → macros du jour + nombre de repas
// GET  /api/meals/history    → agrégats des N derniers jours
//
// `authenticateOptional` : la route reste utilisable sans JWT pendant les
// tests, mais un token valide rattache le repas à son propriétaire.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use(authenticateOptional);

router.post('/', mealController.create.bind(mealController));
router.get('/today', mealController.today.bind(mealController));
router.get('/history', mealController.history.bind(mealController));

export default router;

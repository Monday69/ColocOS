import { Router } from 'express';
import { mealController } from '../controllers/meal.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Meals Routes (journal nutritionnel)
//
// POST /api/meals            → enregistre un repas (items + totaux calculés)
// GET  /api/meals/today      → macros du jour + nombre de repas
// GET  /api/meals/history    → agrégats des N derniers jours
//
// SÉCURITÉ : session obligatoire. Sans JWT, un appelant pouvait écrire un
// repas (et un NutritionLog) au nom de n'importe quel `userId` du body.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use(authenticate);

router.post('/', mealController.create.bind(mealController));
router.get('/today', mealController.today.bind(mealController));
router.get('/history', mealController.history.bind(mealController));

export default router;

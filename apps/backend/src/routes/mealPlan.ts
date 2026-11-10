import { Router } from 'express';
import { mealPlanController } from '../controllers/mealPlan.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Meal Plan Routes (semainier de la coloc)
//
// GET    /api/meal-plan?start=&end=   → repas de la fenêtre
// POST   /api/meal-plan               → upsert (date + slot)
// DELETE /api/meal-plan/:id           → suppression d'un créneau
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use(authenticate);

router.get('/', mealPlanController.getRange.bind(mealPlanController));
router.post('/', mealPlanController.upsert.bind(mealPlanController));
router.patch('/:id/attendees', mealPlanController.updateAttendees.bind(mealPlanController));
router.post('/generate-groceries', mealPlanController.generateGroceries.bind(mealPlanController));
router.delete('/:id', mealPlanController.remove.bind(mealPlanController));

export default router;

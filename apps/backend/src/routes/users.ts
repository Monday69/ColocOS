import { Router } from 'express';
import { usersController } from '../controllers/users.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Users Routes
//
// GET   /api/users/me/profile           → biométrie + objectif nutritionnel
// PATCH /api/users/me/profile           → mise à jour + cibles recalculées
// GET   /api/users/me/nutrition-targets → BMR / TDEE / cibles
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use(authenticate);

router.get('/me/profile', usersController.getProfile.bind(usersController));
router.patch('/me/profile', usersController.updateProfile.bind(usersController));
router.get('/me/nutrition-targets', usersController.getNutritionTargets.bind(usersController));

export default router;

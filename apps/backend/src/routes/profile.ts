import { Router } from 'express';
import { profileController } from '../controllers/profile.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Profile Routes
//
// GET  /api/profile                   → biométrie + cibles (JWT)
// PUT  /api/profile                   → enregistrement + recalcul TDEE (JWT)
// GET  /api/profile/nutrition/today   → cumul du jour (JWT)
// GET  /api/profile/weigh-ins         → historique des pesées (JWT)
// POST /api/profile/weigh-in          → balance Xiaomi (X-Device-Key, sans JWT)
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// Route machine : protégée par X-Device-Key, déclarée AVANT le middleware JWT.
router.post('/weigh-in', profileController.weighIn.bind(profileController));

router.use(authenticate);

router.get('/', profileController.get.bind(profileController));
router.put('/', profileController.update.bind(profileController));
router.get('/nutrition/today', profileController.nutritionToday.bind(profileController));
router.get('/weigh-ins', profileController.weighIns.bind(profileController));

export default router;

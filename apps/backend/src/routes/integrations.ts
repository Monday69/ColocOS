import { Router } from 'express';
import { integrationsController } from '../controllers/integrations.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Integrations Routes (Jarvis Runner)
//
// POST /api/integrations/jarvis/workout  → webhook post-séance (X-Integration-Key)
// GET  /api/integrations/jarvis/upcoming → planning de demain (JWT)
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// Machine → machine : la clé partagée remplace le JWT
router.post('/jarvis/workout', integrationsController.workout.bind(integrationsController));

router.use(authenticate);
router.get('/jarvis/upcoming', integrationsController.upcoming.bind(integrationsController));

export default router;

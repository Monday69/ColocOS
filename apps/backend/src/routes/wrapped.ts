import { Router } from 'express';
import { wrappedController } from '../controllers/wrapped.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Wrapped Routes
//
// GET /api/wrapped/weekly?offset=0|1  → recap hebdomadaire
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);
router.get('/weekly', wrappedController.weekly.bind(wrappedController));

export default router;

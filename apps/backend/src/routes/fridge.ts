import { Router } from 'express';
import { fridgeController } from '../controllers/fridge.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Fridge Routes (Digital Twin)
//
// GET  /api/fridge/state            → État complet pour Three.js (payload léger)
// GET  /api/fridge/zones            → Liste des zones (sans items, pour init R3F)
// GET  /api/fridge/zones/:meshId    → Détail zone (panneau latéral après clic mesh)
//
// NOTE : le paramètre :meshId peut contenir des underscores (ex: fridge_shelf_top)
// Express les gère nativement sans configuration supplémentaire.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use(authenticate);

router.get('/state', fridgeController.getState.bind(fridgeController));
router.get('/zones', fridgeController.listZones.bind(fridgeController));
router.get('/zones/:meshId', fridgeController.getZone.bind(fridgeController));

export default router;
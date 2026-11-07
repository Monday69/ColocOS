import { Router } from 'express';
import { inventoryController } from '../controllers/inventory.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Inventory Routes
//
// Toutes les routes nécessitent une authentification JWT.
// Le middleware `authenticate` injecte req.user dans chaque requête.
// Le controller utilise req.user.id comme ownerId par défaut.
//
// POST   /api/inventory/scan              → Scan code-barres (OFF)
// POST   /api/inventory/items             → Ajouter un item au stock
// GET    /api/inventory/items             → Lister le stock (avec filtres)
// GET    /api/inventory/items/:id         → Détail d'un item
// PATCH  /api/inventory/items/:id/consume → Consommer une quantité
// GET    /api/inventory/alerts/expiry     → Alertes DLC
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// Applique authenticate sur TOUTES les routes de ce groupe
router.use(authenticate);

// ── Scanner ──────────────────────────────────────────────────────────────────
router.post('/scan', inventoryController.scan.bind(inventoryController));

// ── Items ────────────────────────────────────────────────────────────────────
router.post('/items', inventoryController.addItem.bind(inventoryController));
router.get('/items', inventoryController.listItems.bind(inventoryController));
router.get('/items/:id', inventoryController.getItem.bind(inventoryController));
router.patch(
  '/items/:id/consume',
  inventoryController.consumeItem.bind(inventoryController),
);

// ── Alertes DLC ───────────────────────────────────────────────────────────────
router.get(
  '/alerts/expiry',
  inventoryController.getExpiryAlerts.bind(inventoryController),
);

export default router;
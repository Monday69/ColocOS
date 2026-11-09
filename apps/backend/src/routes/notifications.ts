import { Router } from 'express';
import { notificationsController } from '../controllers/notifications.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Notifications Routes (Web Push)
//
// GET    /api/notifications/public-key  → clé VAPID publique (front)
// GET    /api/notifications/status      → { configured, subscriptions }
// POST   /api/notifications/subscribe   → enregistre l'abonnement du navigateur
// DELETE /api/notifications/subscribe   → supprime l'abonnement
// POST   /api/notifications/test        → push de test à soi-même
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use(authenticate);

router.get('/public-key', notificationsController.getPublicKey.bind(notificationsController));
router.get('/status', notificationsController.status.bind(notificationsController));
router.post('/subscribe', notificationsController.subscribe.bind(notificationsController));
router.delete('/subscribe', notificationsController.unsubscribe.bind(notificationsController));
router.post('/test', notificationsController.sendTest.bind(notificationsController));

export default router;

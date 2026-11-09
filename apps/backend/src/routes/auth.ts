import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Auth Routes
//
// POST   /api/auth/register          → Inscription (public, rate-limited)
// POST   /api/auth/login             → Connexion (public, rate-limited)
// POST   /api/auth/refresh           → Renouvellement access token (public)
// GET    /api/auth/me                → Profil connecté (protégé)
// PATCH  /api/auth/me                → Mise à jour profil (protégé)
// GET    /api/auth/roommates         → Liste des colocataires (protégé)
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// Rate limiter spécifique aux endpoints sensibles (anti brute-force)
// Plus restrictif que le rate limiter global de app.ts
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives max par IP par fenêtre
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Trop de tentatives. Veuillez réessayer dans 15 minutes.',
  },
  // Ne compte pas les requêtes réussies (code < 400)
  skipSuccessfulRequests: true,
});

// ── Routes publiques (pas d'auth requise) ─────────────────────────────────────
router.get('/profiles', authController.profiles.bind(authController));

router.post(
  '/register',
  authRateLimiter,
  authController.register.bind(authController),
);

router.post(
  '/login',
  authRateLimiter,
  authController.login.bind(authController),
);

// Sélecteur de profils (tablette partagée) — rate-limited comme /login
router.post(
  '/login-pin',
  authRateLimiter,
  authController.loginPin.bind(authController),
);

router.post(
  '/setup-pin',
  authRateLimiter,
  authController.setupPin.bind(authController),
);

router.post(
  '/refresh',
  authController.refresh.bind(authController),
);

// ── Routes protégées (JWT obligatoire) ────────────────────────────────────────
router.post(
  '/me/pin',
  authenticate,
  authController.updatePin.bind(authController),
);

router.get(
  '/me',
  authenticate,
  authController.me.bind(authController),
);

router.patch(
  '/me',
  authenticate,
  authController.updateMe.bind(authController),
);

router.get(
  '/roommates',
  authenticate,
  authController.listRoommates.bind(authController),
);

export default router;
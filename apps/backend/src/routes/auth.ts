import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Auth Routes
//
// POST   /api/auth/request-invite    → Demande d'accès (public, rate-limited strict)
// GET    /api/auth/approve-invite    → Formulaire d'approbation (admin)
// POST   /api/auth/approve-invite    → Validation + envoi du code (admin)
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

// Rate limiter strict pour la création de demandes d'accès : une demande
// envoie un email à l'administrateur, il faut la protéger du spam.
const inviteRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 3, // 3 demandes max par IP par heure
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Trop de demandes. Veuillez réessayer dans une heure.',
  },
});

// ── Routes publiques (pas d'auth requise) ─────────────────────────────────────
router.get('/profiles', authController.profiles.bind(authController));

// Inscription sur demande (approbation administrateur par email)
router.post(
  '/request-invite',
  inviteRequestLimiter,
  authController.requestInvite.bind(authController),
);
router.get('/approve-invite', authController.approveInvitePage.bind(authController));
router.post('/approve-invite', authController.approveInvite.bind(authController));

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

// Sélection de profil sans PIN (mode AUTO_DEVICE)
router.post(
  '/device',
  authRateLimiter,
  authController.deviceLogin.bind(authController),
);

// Lien magique NFC : GET public (le jeton du badge est le secret)
router.get('/nfc', authController.nfcLogin.bind(authController));

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

router.post(
  '/nfc/regenerate',
  authenticate,
  authController.regenerateNfc.bind(authController),
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
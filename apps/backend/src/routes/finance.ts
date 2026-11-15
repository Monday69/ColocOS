import { Router } from 'express';
import { financeController } from '../controllers/finance.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { safeEqual } from '../utils/safeCompare';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Finance Routes
//
// GET  /api/finance/status           → Résumé complet (balance perso + dettes + stats mois)
// GET  /api/finance/balances         → Soldes nets de tous les colocataires
// GET  /api/finance/debts            → Virements simplifiés (algorithme greedy)
// GET  /api/finance/expenses         → Historique paginé des dépenses
// POST /api/finance/expenses         → Enregistrer une nouvelle dépense
// POST /api/finance/settle           → Enregistrer un remboursement (JWT requis)
// POST /api/finance/settle-nfc       → Règlement Hybrid-Pay via badge NFC
//                                      ⚠️  Pas d'authenticate — identification par badgeId
//                                      Sécurisé par X-Terminal-Secret header
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// ── Route NFC — hors session JWT ──────────────────────────────────────────────
// Doit être déclarée AVANT router.use(authenticate) pour ne pas être protégée.
// Sécurisée par un secret de borne partagé (X-Terminal-Secret).
router.post('/settle-nfc', (req, res, next) => {
  const expected = env.TERMINAL_SECRET;

  // Production : TERMINAL_SECRET est garanti par config/env.ts.
  // Développement sans secret : on laisse passer, avec un avertissement.
  if (!expected) {
    logger.warn('[Finance] settle-nfc appelé sans TERMINAL_SECRET configuré (mode dev).');
  } else if (!safeEqual(req.headers['x-terminal-secret'], expected)) {
    res.status(401).json({ success: false, error: 'Secret de borne invalide.' });
    return;
  }

  next();
}, financeController.settleByBadge.bind(financeController));

// ── Routes protégées par JWT ───────────────────────────────────────────────────
router.use(authenticate);

router.get('/status',   financeController.getStatus.bind(financeController));
router.get('/balances', financeController.getBalances.bind(financeController));
router.get('/debts',    financeController.getDebts.bind(financeController));
router.get('/expenses', financeController.getHistory.bind(financeController));

router.post('/expenses', financeController.addExpense.bind(financeController));
router.post('/settle',   financeController.settle.bind(financeController));

export default router;
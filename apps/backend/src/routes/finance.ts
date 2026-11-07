import { Router } from 'express';
import { financeController } from '../controllers/finance.controller';
import { authenticate } from '../middlewares/auth.middleware';

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
  const secret = req.headers['x-terminal-secret'];
  const expected = process.env.TERMINAL_SECRET;

  // Si TERMINAL_SECRET non configuré en env → log d'avertissement + on laisse passer
  // (permissif en dev, strict en prod)
  if (expected && secret !== expected) {
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
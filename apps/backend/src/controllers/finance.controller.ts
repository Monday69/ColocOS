import { Request, Response, NextFunction } from 'express';
import { financeService } from '../services/finance.service';
import {
  CreateExpenseSchema,
  SettleDebtSchema,
  ExpenseHistoryQuerySchema,
} from '../dtos/finance.dto';
import { AppError } from '../middlewares/errorHandler';
import { ApiResponse } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Finance Controller
// ─────────────────────────────────────────────────────────────────────────────

export class FinanceController {
  /**
   * POST /api/finance/expenses
   * Enregistre une nouvelle dépense.
   * Le payeur est automatiquement l'utilisateur connecté.
   */
  async addExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');

      const dto = CreateExpenseSchema.parse(req.body);
      const expense = await financeService.addExpense(dto, req.user.id);

      res.status(201).json({
        success: true,
        data: expense,
        message: `Dépense "${expense.description}" de ${expense.amount}€ enregistrée — répartie entre ${expense.splits.length} personnes.`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/finance/status
   * Résumé financier complet : balance perso + toutes les balances + dettes simplifiées + stats mois.
   */
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');

      const status = await financeService.getFinanceStatus(req.user.id);

      const myBalance = status.currentUser.netBalance;
      const message =
        myBalance > 0
          ? `Vous êtes créditeur de ${myBalance.toFixed(2)}€.`
          : myBalance < 0
          ? `Vous devez ${Math.abs(myBalance).toFixed(2)}€.`
          : 'Votre balance est à zéro.';

      res.status(200).json({
        success: true,
        data: status,
        message,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/finance/balances
   * Balances nettes de tous les colocataires (sans les dettes simplifiées).
   * Utile pour afficher la liste des soldes dans l'UI.
   */
  async getBalances(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const balances = await financeService.getUserBalances();

      res.status(200).json({
        success: true,
        data: balances,
        meta: { total: balances.length },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/finance/debts
   * Liste minimale des virements à effectuer pour remettre tout le monde à zéro.
   */
  async getDebts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const debts = await financeService.getSimplifiedDebts();

      res.status(200).json({
        success: true,
        data: debts,
        meta: { total: debts.length },
        message: debts.length === 0
          ? 'Tout le monde est à l\'équilibre.'
          : `${debts.length} virement(s) nécessaire(s) pour solder toutes les dettes.`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/finance/settle
   * Enregistre un remboursement depuis l'utilisateur connecté vers un créditeur.
   */
  async settle(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');

      const dto = SettleDebtSchema.parse(req.body);
      const result = await financeService.settleDebt(req.user.id, dto);

      res.status(201).json({
        success: true,
        data: result,
        message: `${result.fromName} a remboursé ${result.amount}€ à ${result.toName}.`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
  async settleByBadge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { badgeId, ...debtData } = req.body;

      if (!badgeId) {
        throw new AppError(400, 'Badge ID (numéro de série) manquant.');
      }

      // On valide les données du remboursement (montant, destinataire) via ton DTO existant
      const dto = SettleDebtSchema.parse(debtData);

      // On appelle la nouvelle méthode du service
      const result = await financeService.settleByBadge(badgeId, dto);

      res.status(201).json({
        success: true,
        data: result,
        message: `[Hybrid-Pay] ${result.fromName} a réglé ${result.amount}€ à ${result.toName} via Badge NFC.`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
  /**
   * GET /api/finance/expenses
   * Historique paginé des dépenses avec filtres mois/année/catégorie.
   */
  async getHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = ExpenseHistoryQuerySchema.parse(req.query);
      const result = await financeService.getExpenseHistory(query);

      res.status(200).json({
        success: true,
        data: result.expenses,
        meta: {
          page: result.page,
          limit: result.limit,
          total: result.total,
        },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
}

export const financeController = new FinanceController();
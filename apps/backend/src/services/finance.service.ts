// finance.service.ts

import Decimal from 'decimal.js';
import { ExpenseCategory, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';
import {
  CreateExpenseDTO,
  SettleDebtDTO,
  ExpenseHistoryQueryDTO,
} from '../dtos/finance.dto';
import {
  simplifyDebts,
  splitEqually,
  validateCustomSplits,
  toMoney,
  BalanceEntry,
  DebtTransaction,
} from '../lib/debtSimplifier';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Finance Service
//
// PRÉCISION MONÉTAIRE :
//   - Toutes les opérations arithmétiques utilisent Decimal.js
//   - Les valeurs sont stockées en DECIMAL(10,2) en BDD (Prisma Decimal)
//   - Les réponses JSON serialisent en number (toMoney())
//   - Zéro Number natif dans les calculs — uniquement pour la sérialisation
// ─────────────────────────────────────────────────────────────────────────────

// ── Types retournés ───────────────────────────────────────────────────────────

export interface ExpenseWithSplits {
  id: string;
  description: string;
  amount: number;
  category: string;
  paidBy: { id: string; name: string; colorHex: string };
  splits: Array<{
    userId: string;
    userName: string;
    shareAmount: number;
    isSettled: boolean;
  }>;
  createdAt: string;
}

export interface UserBalance {
  userId: string;
  name: string;
  colorHex: string;
  totalPaid: number;
  totalOwed: number;
  netBalance: number; // positif = créditeur, négatif = débiteur
}

export interface FinanceStatus {
  currentUser: UserBalance;
  allBalances: UserBalance[];
  simplifiedDebts: Omit<DebtTransaction, 'amountDecimal'>[];
  monthlyStats: {
    month: number;
    year: number;
    totalSpent: number;
    expenseCount: number;
    byCategory: Record<string, number>;
  };
}

export interface SettleResult {
  transactionId: string;
  fromName: string;
  toName: string;
  amount: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class FinanceService {
  /**
   * Crée une dépense et ses splits en une seule transaction Prisma atomique.
   *
   * RÉPARTITION :
   *   1. customSplits fournis → validation somme = total → utilise les montants exacts
   *   2. participantIds fournis → répartition équitable entre ces users (splitEqually)
   *   3. Ni l'un ni l'autre → répartition équitable entre TOUS les colocataires
   *
   * @throws AppError(404) si paidById ou un participantId est introuvable
   * @throws AppError(400) si customSplits ne somme pas au total
   */
  async addExpense(
    data: CreateExpenseDTO,
    paidById: string,
  ): Promise<ExpenseWithSplits> {
    const totalDecimal = new Decimal(data.amount);

    // ── Résolution des participants ────────────────────────────────────────
    let participantIds: string[];

    if (data.customSplits && data.customSplits.length > 0) {
      participantIds = data.customSplits.map((s) => s.userId);
    } else if (data.participantIds && data.participantIds.length > 0) {
      participantIds = data.participantIds;
    } else {
      // Tous les colocataires
      const allUsers = await prisma.user.findMany({ select: { id: true } });
      participantIds = allUsers.map((u) => u.id);
    }

    // ── Validation que tous les participants existent ─────────────────────
    const participants = await prisma.user.findMany({
      where: { id: { in: participantIds } },
      select: { id: true, name: true },
    });

    if (participants.length !== participantIds.length) {
      const missing = participantIds.filter(
        (id) => !participants.find((u) => u.id === id),
      );
      throw new AppError(404, `Participants introuvables : ${missing.join(', ')}`);
    }

    // Vérifier que paidById existe
    const payer = await prisma.user.findUnique({
      where: { id: paidById },
      select: { id: true, name: true, colorHex: true },
    });
    if (!payer) throw new AppError(404, 'Payeur introuvable');

    // ── Calcul des montants par participant ───────────────────────────────
    let splitAmounts: Map<string, Decimal>;

    if (data.customSplits && data.customSplits.length > 0) {
      // Validation : la somme doit correspondre au total
      if (!validateCustomSplits(totalDecimal, data.customSplits)) {
        throw new AppError(
          400,
          `La somme des splits (${data.customSplits.reduce((s, c) => s + c.amount, 0).toFixed(2)}€) ` +
            `ne correspond pas au total (${data.amount.toFixed(2)}€). Tolérance : 0.01€.`,
        );
      }
      splitAmounts = new Map(
        data.customSplits.map((s) => [s.userId, new Decimal(s.amount)]),
      );
    } else {
      // Répartition équitable avec redistribution des centimes résiduels
      const amounts = splitEqually(totalDecimal, participants.length);
      splitAmounts = new Map(
        participants.map((p, i) => [p.id, amounts[i]]),
      );
    }

    // ── Transaction Prisma atomique ───────────────────────────────────────
    // Garantit : soit tout est créé, soit rien ne l'est
    const expense = await prisma.$transaction(async (tx) => {
      // 1. Créer la dépense
      const newExpense = await tx.expense.create({
        data: {
          description: data.description,
          amount: totalDecimal.toFixed(2),
          category: data.category as ExpenseCategory,
          receiptUrl: data.receiptUrl ?? null,
          paidById,
        },
      });

      // 2. Créer tous les splits
      await tx.expenseSplit.createMany({
        data: Array.from(splitAmounts.entries()).map(([userId, amount]) => ({
          expenseId: newExpense.id,
          userId,
          shareAmount: amount.toFixed(2),
          isSettled: false,
        })),
      });

      // 3. Log d'activité
      await tx.activityLog.create({
        data: {
          action: 'EXPENSE_CREATED',
          userId: paidById,
          meta: {
            expenseId: newExpense.id,
            description: data.description,
            amount: toMoney(totalDecimal),
            category: data.category,
            participantCount: participantIds.length,
            participantIds,
          },
        },
      });

      return newExpense;
    });

    logger.info(
      `[Finance] Dépense créée : "${data.description}" — ${toMoney(totalDecimal)}€ ` +
        `payé par ${payer.name}, réparti entre ${participantIds.length} personnes`,
    );

    // ── Reload avec relations pour la réponse ─────────────────────────────
    return this.getExpenseById(expense.id);
  }

  /**
   * Calcule le solde net de chaque utilisateur depuis les données BDD.
   *
   * Balance_i = Σ(dépenses payées par i) − Σ(parts dues par i)
   *
   * IMPLÉMENTATION :
   *   Deux requêtes agrégées (SUM groupé) + jointure en mémoire.
   *   Plus efficace qu'un findMany + calcul row-by-row.
   */
  async getUserBalances(): Promise<UserBalance[]> {
    // Récupère tous les utilisateurs
    const users = await prisma.user.findMany({
      select: { id: true, name: true, colorHex: true },
      orderBy: { name: 'asc' },
    });

    // Agrégation 1 : somme de ce que chaque user a payé
    const paidAggregates = await prisma.expense.groupBy({
      by: ['paidById'],
      _sum: { amount: true },
    });

    const paidByUser = new Map<string, Decimal>(
      paidAggregates.map((row) => [
        row.paidById,
        new Decimal(row._sum.amount?.toString() ?? '0'),
      ]),
    );

    // Agrégation 2 : somme de ce que chaque user doit (ses parts dans les splits)
    const owedAggregates = await prisma.expenseSplit.groupBy({
      by: ['userId'],
      _sum: { shareAmount: true },
    });

    const owedByUser = new Map<string, Decimal>(
      owedAggregates.map((row) => [
        row.userId,
        new Decimal(row._sum.shareAmount?.toString() ?? '0'),
      ]),
    );

    // Jointure en mémoire + calcul de la balance nette
    return users.map((user) => {
      const totalPaid = paidByUser.get(user.id) ?? new Decimal(0);
      const totalOwed = owedByUser.get(user.id) ?? new Decimal(0);
      const netBalance = totalPaid.minus(totalOwed);

      return {
        userId: user.id,
        name: user.name,
        colorHex: user.colorHex,
        totalPaid: toMoney(totalPaid),
        totalOwed: toMoney(totalOwed),
        netBalance: toMoney(netBalance),
      };
    });
  }

  /**
   * Retourne les dettes simplifiées via l'algorithme Greedy.
   * Construit les BalanceEntry (Decimal) depuis getUserBalances()
   * et délègue à simplifyDebts().
   */
  async getSimplifiedDebts(): Promise<Omit<DebtTransaction, 'amountDecimal'>[]> {
    const balances = await this.getUserBalances();

    // Convertit en BalanceEntry avec Decimal pour l'algo
    const entries: BalanceEntry[] = balances.map((b) => ({
      userId:   b.userId,
      name:     b.name,
      colorHex: b.colorHex,
      balance:  new Decimal(b.netBalance),
    }));

    const transactions = simplifyDebts(entries);

    // Retire le champ interne amountDecimal avant la sérialisation JSON
    return transactions.map(({ amountDecimal: _internal, ...rest }) => rest);
  }

  /**
   * Enregistre un règlement de dette entre deux utilisateurs.
   * Crée une Transaction + met à jour les splits settled + log d'activité.
   *
   * LOGIQUE settle :
   *   Le montant peut être partiel (règlement progressif autorisé).
   *   On marque isSettled = true sur les ExpenseSplit du débiteur au fur et
   *   à mesure, en commençant par les plus anciens.
   */
  async settleDebt(
    fromUserId: string,
    dto: SettleDebtDTO,
  ): Promise<SettleResult> {
    // Vérifications
    if (fromUserId === dto.toUserId) {
      throw new AppError(400, 'Impossible de se rembourser soi-même.');
    }

    const [fromUser, toUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: fromUserId }, select: { id: true, name: true } }),
      prisma.user.findUnique({ where: { id: dto.toUserId }, select: { id: true, name: true } }),
    ]);

    if (!fromUser) throw new AppError(404, 'Utilisateur (from) introuvable.');
    if (!toUser)   throw new AppError(404, 'Utilisateur (to) introuvable.');

    const amountDecimal = new Decimal(dto.amount);

    // Vérifier que le débiteur doit effectivement de l'argent au créditeur
    const currentDebts = await this.getSimplifiedDebts();
    const relevantDebt = currentDebts.find(
      (d) => d.fromUserId === fromUserId && d.toUserId === dto.toUserId,
    );

    if (!relevantDebt) {
      throw new AppError(
        400,
        `${fromUser.name} ne doit rien à ${toUser.name} selon les balances actuelles.`,
      );
    }

    if (amountDecimal.greaterThan(new Decimal(relevantDebt.amount).plus('0.01'))) {
      throw new AppError(
        400,
        `Le montant du règlement (${dto.amount}€) dépasse la dette actuelle (${relevantDebt.amount}€).`,
      );
    }

    // ── Transaction Prisma atomique ───────────────────────────────────────
    const result = await prisma.$transaction(async (tx) => {
      // 1. Créer la transaction de remboursement
      const transaction = await tx.transaction.create({
        data: {
          fromUserId,
          toUserId: dto.toUserId,
          amount: amountDecimal.toFixed(2),
          note: dto.note ?? null,
        },
      });

      // 2. Marquer les splits non-réglés du débiteur comme settled
      //    On itère par ordre chronologique, en marquant jusqu'à épuisement du montant
      let remainingToSettle = amountDecimal;

      const unsettledSplits = await tx.expenseSplit.findMany({
        where: {
          userId: fromUserId,
          isSettled: false,
          expense: { paidById: dto.toUserId },
        },
        include: { expense: true },
        orderBy: { expense: { createdAt: 'asc' } },
      });

      for (const split of unsettledSplits) {
        if (remainingToSettle.lessThanOrEqualTo(0)) break;

        const splitAmount = new Decimal(split.shareAmount.toString());
        if (splitAmount.lessThanOrEqualTo(remainingToSettle)) {
          await tx.expenseSplit.update({
            where: { id: split.id },
            data: { isSettled: true },
          });
          remainingToSettle = remainingToSettle.minus(splitAmount);
        }
      }

      // 3. Log d'activité
      await tx.activityLog.create({
        data: {
          action: 'EXPENSE_SETTLED',
          userId: fromUserId,
          meta: {
            transactionId: transaction.id,
            fromUserId,
            fromName: fromUser.name,
            toUserId: dto.toUserId,
            toName: toUser.name,
            amount: toMoney(amountDecimal),
            note: dto.note ?? null,
          },
        },
      });

      return transaction;
    });

    logger.info(
      `[Finance] Règlement : ${fromUser.name} → ${toUser.name} — ${dto.amount}€`,
    );

    return {
      transactionId: result.id,
      fromName: fromUser.name,
      toName: toUser.name,
      amount: toMoney(amountDecimal),
    };
  }
  
  async settleByBadge(
      badgeId: string,
      dto: SettleDebtDTO
    ): Promise<SettleResult> {
      // 1. On cherche qui possède ce badge dans la table 'users'
      const user = await prisma.user.findUnique({
        where: { badgeId }, // Ce champ doit être ajouté dans ton schema.prisma
        select: { id: true, name: true }
      });

      if (!user) {
        logger.warn(`[Hybrid-Pay] Badge inconnu détecté : ${badgeId}`);
        throw new AppError(404, "Badge non reconnu. L'utilisateur doit l'associer à son compte.");
      }

      logger.info(`[Hybrid-Pay] Paiement initié par ${user.name} via badge NFC`);

      // 2. On appelle la fonction settleDebt que tu as déjà écrite au-dessus
      // On lui passe l'ID de l'utilisateur trouvé via le badge
      return this.settleDebt(user.id, {
        toUserId: dto.toUserId,
        amount: dto.amount,
        note: dto.note || `Règlement Hybrid-Pay (Badge: ${badgeId})`
      });
    }
  /**
   * Retourne le statut financier complet pour la route GET /finance/status.
   * Combine balances + dettes simplifiées + stats du mois courant.
   */
  async getFinanceStatus(currentUserId: string): Promise<FinanceStatus> {
    const now = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1; // 1-indexed

    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth   = new Date(year, month, 0, 23, 59, 59, 999);

    // Requêtes en parallèle
    const [allBalances, simplifiedDebts, monthlyExpenses] = await Promise.all([
      this.getUserBalances(),
      this.getSimplifiedDebts(),
      prisma.expense.findMany({
        where: {
          createdAt: { gte: startOfMonth, lte: endOfMonth },
        },
        select: {
          amount: true,
          category: true,
        },
      }),
    ]);

    // Stats mensuelles
    const totalSpentDecimal = monthlyExpenses.reduce(
      (acc, e) => acc.plus(new Decimal(e.amount.toString())),
      new Decimal(0),
    );

    const byCategory = monthlyExpenses.reduce<Record<string, number>>((acc, e) => {
      const cat = e.category as string;
      const current = new Decimal(acc[cat] ?? 0);
      acc[cat] = toMoney(current.plus(new Decimal(e.amount.toString())));
      return acc;
    }, {});

    const currentUser = allBalances.find((b) => b.userId === currentUserId);
    if (!currentUser) {
      throw new AppError(404, 'Utilisateur introuvable dans les balances.');
    }

    return {
      currentUser,
      allBalances,
      simplifiedDebts,
      monthlyStats: {
        month,
        year,
        totalSpent: toMoney(totalSpentDecimal),
        expenseCount: monthlyExpenses.length,
        byCategory,
      },
    };
  }

  /**
   * Historique paginé des dépenses avec filtres.
   */
  async getExpenseHistory(query: ExpenseHistoryQueryDTO) {
    const now = new Date();
    const year  = query.year  ?? now.getFullYear();
    const month = query.month ?? now.getMonth() + 1;

    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 0, 23, 59, 59, 999);

    const where: Prisma.ExpenseWhereInput = {
      createdAt: { gte: startDate, lte: endDate },
      ...(query.category ? { category: query.category as ExpenseCategory } : {}),
    };

    const [expenses, total] = await prisma.$transaction([
      prisma.expense.findMany({
        where,
        include: {
          paidBy: { select: { id: true, name: true, colorHex: true } },
          splits: {
            include: {
              user: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.expense.count({ where }),
    ]);

    return {
      expenses: expenses.map((e) => this.formatExpense(e)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  // ── Helpers privés ──────────────────────────────────────────────────────────

  private async getExpenseById(id: string): Promise<ExpenseWithSplits> {
    const expense = await prisma.expense.findUniqueOrThrow({
      where: { id },
      include: {
        paidBy: { select: { id: true, name: true, colorHex: true } },
        splits: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });
    return this.formatExpense(expense);
  }

  private formatExpense(expense: {
    id: string;
    description: string;
    amount: Prisma.Decimal;
    category: ExpenseCategory;
    createdAt: Date;
    paidBy: { id: string; name: string; colorHex: string };
    splits: Array<{
      userId: string;
      shareAmount: Prisma.Decimal;
      isSettled: boolean;
      user: { id: string; name: string };
    }>;
  }): ExpenseWithSplits {
    return {
      id: expense.id,
      description: expense.description,
      amount: toMoney(new Decimal(expense.amount.toString())),
      category: expense.category,
      paidBy: expense.paidBy,
      splits: expense.splits.map((s) => ({
        userId: s.userId,
        userName: s.user.name,
        shareAmount: toMoney(new Decimal(s.shareAmount.toString())),
        isSettled: s.isSettled,
      })),
      createdAt: expense.createdAt.toISOString(),
    };
  }
}

export const financeService = new FinanceService();
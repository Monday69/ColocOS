import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Finance DTOs
// ─────────────────────────────────────────────────────────────────────────────

// ── Catégories ────────────────────────────────────────────────────────────────

export const ExpenseCategorySchema = z.enum([
  'groceries',
  'utilities',
  'rent',
  'other',
]);

// ── Créer une dépense ─────────────────────────────────────────────────────────

export const CreateExpenseSchema = z.object({
  description: z
    .string()
    .min(1, 'La description est requise')
    .max(255)
    .trim(),

  amount: z
    .number()
    .positive('Le montant doit être positif')
    .max(99999.99, 'Montant trop élevé')
    // Arrondi à 2 décimales à l'entrée
    .transform((n) => Math.round(n * 100) / 100),

  category: ExpenseCategorySchema.default('other'),

  receiptUrl: z.string().url('URL de reçu invalide').optional().nullable(),

  /**
   * Liste des userIds participants.
   * Si null ou [] → répartition équitable entre TOUS les colocataires.
   * Si fourni → répartition uniquement entre ces utilisateurs.
   */
  participantIds: z
    .array(z.string().uuid())
    .min(1, 'Au moins un participant requis')
    .optional()
    .nullable(),

  /**
   * Répartition personnalisée (montants exacts par userId).
   * Si fourni, doit couvrir exactement le montant total (± 0.01€ de tolérance
   * pour l'arrondi centimes).
   * Si null → répartition automatique équitable.
   */
  customSplits: z
    .array(
      z.object({
        userId: z.string().uuid(),
        amount: z
          .number()
          .positive()
          .transform((n) => Math.round(n * 100) / 100),
      }),
    )
    .optional()
    .nullable(),
});

export type CreateExpenseDTO = z.infer<typeof CreateExpenseSchema>;

// ── Régler une dette ──────────────────────────────────────────────────────────

export const SettleDebtSchema = z.object({
  /**
   * Le débiteur (fromUserId) est toujours l'utilisateur connecté (req.user.id).
   * On ne peut pas "payer à la place de quelqu'un".
   */
  toUserId: z.string().uuid('toUserId doit être un UUID valide'),

  amount: z
    .number()
    .positive('Le montant du règlement doit être positif')
    .max(99999.99)
    .transform((n) => Math.round(n * 100) / 100),

  note: z.string().max(255).optional().nullable(),
});

export type SettleDebtDTO = z.infer<typeof SettleDebtSchema>;

// ── Filtres historique ────────────────────────────────────────────────────────

export const ExpenseHistoryQuerySchema = z.object({
  month: z.coerce
    .number()
    .int()
    .min(1)
    .max(12)
    .optional(),
  year: z.coerce
    .number()
    .int()
    .min(2020)
    .max(2099)
    .optional(),
  category: ExpenseCategorySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ExpenseHistoryQueryDTO = z.infer<typeof ExpenseHistoryQuerySchema>;
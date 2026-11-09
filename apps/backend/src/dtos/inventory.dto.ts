import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Inventory DTOs
// Validation Zod pour toutes les entrées de l'API inventaire
// ─────────────────────────────────────────────────────────────────────────────

// ── Scan ─────────────────────────────────────────────────────────────────────

export const ScanBarcodeSchema = z.object({
  barcode: z
    .string()
    .min(8, 'Le code-barres doit faire au moins 8 caractères')
    .max(14, 'Le code-barres ne peut pas dépasser 14 caractères')
    .regex(/^\d+$/, 'Le code-barres ne doit contenir que des chiffres'),
});

export type ScanBarcodeDTO = z.infer<typeof ScanBarcodeSchema>;

// ── Ajout d'item ─────────────────────────────────────────────────────────────

export const UnitSchema = z.enum(['g', 'kg', 'ml', 'L', 'unit']);

export const CreateItemSchema = z.object({
  name: z
    .string()
    .min(1, 'Le nom est requis')
    .max(255)
    .transform((s) => s.trim()),
  brand: z.string().max(100).optional().nullable(),
  barcode: z.string().max(50).optional().nullable(),
  quantity: z
    .number()
    .positive('La quantité doit être positive')
    .max(99999),
  unit: UnitSchema.default('unit'),
  expiryDate: z
    .string()
    .datetime({ message: 'Format de date invalide (ISO 8601 requis)' })
    .optional()
    .nullable()
    .transform((d) => (d ? new Date(d) : null)),
  imageUrl: z.string().url().optional().nullable(),
  nutriscore: z
    .enum(['A', 'B', 'C', 'D', 'E'])
    .optional()
    .nullable(),
  isShared: z.boolean().default(true),
  storageZoneId: z.string().uuid('storageZoneId doit être un UUID valide'),
  ownerId: z.string().uuid().optional().nullable(),

  // ── Nutrition (Open Food Facts, pour 100 g / 100 ml) ──────────────────────
  calories: z.number().min(0).max(10000).optional().nullable(),
  proteins: z.number().min(0).max(1000).optional().nullable(),
  carbohydrates: z.number().min(0).max(1000).optional().nullable(),
  fat: z.number().min(0).max(1000).optional().nullable(),
  fiber: z.number().min(0).max(1000).optional().nullable(),
  novaGroup: z.number().int().min(1).max(4).optional().nullable(),
});

export type CreateItemDTO = z.infer<typeof CreateItemSchema>;

// ── Consommation d'item ───────────────────────────────────────────────────────

export const ConsumeItemSchema = z.object({
  quantity: z
    .number()
    .positive('La quantité consommée doit être positive'),
});

export type ConsumeItemDTO = z.infer<typeof ConsumeItemSchema>;

// ── Consommation progressive (Sprint 2) ──────────────────────────────────────

export const ConsumePartSchema = z.object({
  amount: z
    .number()
    .positive('La quantité consommée doit être strictement positive')
    .max(99999, 'Quantité trop importante'),
});

export type ConsumePartDTO = z.infer<typeof ConsumePartSchema>;

// ── Suppression d'item ─────────────────────────────────────────────────────────

export const ItemIdParamSchema = z.object({
  id: z.string().uuid('id doit être un UUID valide'),
});

export type ItemIdParamDTO = z.infer<typeof ItemIdParamSchema>;

// ── Mise à jour partielle ─────────────────────────────────────────────────────

export const UpdateItemSchema = CreateItemSchema.partial().omit({
  barcode: true,
  storageZoneId: true,
});

export type UpdateItemDTO = z.infer<typeof UpdateItemSchema>;

// ── Filtres de liste ──────────────────────────────────────────────────────────

export const ListItemsQuerySchema = z.object({
  storageZoneId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  isShared: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  expiringInDays: z.coerce.number().int().min(1).max(90).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListItemsQueryDTO = z.infer<typeof ListItemsQuerySchema>;

// ── Sprint 3 : ajout rapide d'un aliment frais (sans code-barres) ─────────────

export const QuickAddSchema = z.object({
  name: z.string().trim().max(120, 'Nom trop long (120 caractères max)').optional(),
  presetId: z.string().trim().max(60).optional(),
  quantity: z.number().positive('La quantité doit être strictement positive').max(99999).optional(),
  unit: z.enum(['unit', 'g', 'kg', 'ml', 'L']).optional(),
  shelfLifeDays: z.number().int().min(0).max(3650).optional(),
  storageZoneId: z.string().uuid('Zone de stockage invalide').optional(),
  isShared: z.boolean().optional(),
  /** Override manuel de la DLC (mini date-picker) — `YYYY-MM-DD` */
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (format YYYY-MM-DD)')
    .optional(),
});

export type QuickAddDTO = z.infer<typeof QuickAddSchema>;

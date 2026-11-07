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
});

export type CreateItemDTO = z.infer<typeof CreateItemSchema>;

// ── Consommation d'item ───────────────────────────────────────────────────────

export const ConsumeItemSchema = z.object({
  quantity: z
    .number()
    .positive('La quantité consommée doit être positive'),
});

export type ConsumeItemDTO = z.infer<typeof ConsumeItemSchema>;

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
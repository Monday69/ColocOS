import { z } from 'zod';
import { NutritionGoal } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Users DTOs (profil & biométrie)
// ─────────────────────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` (date seule, ce que renvoie un `<input type="date">`) ou ISO. */
const DateLike = z
  .string()
  .trim()
  .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isNaN(new Date(value).getTime()), {
    message: 'Date invalide (YYYY-MM-DD ou ISO 8601).',
  });

export const UpdateProfileSchema = z.object({
  birthDate: DateLike.nullable().optional(),
  heightCm: z.number().min(80, 'Taille minimale : 80 cm').max(250, 'Taille maximale : 250 cm').nullable().optional(),
  weightKg: z.number().min(25, 'Poids minimal : 25 kg').max(250, 'Poids maximal : 250 kg').nullable().optional(),
  gender: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(['M', 'F', 'MALE', 'FEMALE', 'HOMME', 'FEMME']))
    .nullable()
    .optional(),
  activityLevel: z.number().min(1.2, 'Niveau d’activité minimal : 1.2').max(1.9, 'Niveau d’activité maximal : 1.9').optional(),
  nutritionGoal: z.nativeEnum(NutritionGoal).optional(),
});

export type UpdateProfileDTO = z.infer<typeof UpdateProfileSchema>;

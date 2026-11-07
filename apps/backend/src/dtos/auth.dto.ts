import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Auth DTOs
// Validation Zod stricte pour l'inscription et la connexion
// ─────────────────────────────────────────────────────────────────────────────

// ── Règles de validation réutilisables ───────────────────────────────────────

const passwordSchema = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
  .max(128, 'Le mot de passe ne peut pas dépasser 128 caractères')
  .regex(/[A-Z]/, 'Le mot de passe doit contenir au moins une majuscule')
  .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre')
  .regex(
    /[^A-Za-z0-9]/,
    'Le mot de passe doit contenir au moins un caractère spécial',
  );

const emailSchema = z
  .string()
  .email('Format d\'email invalide')
  .max(255)
  .toLowerCase()
  .trim();

// ── Register ─────────────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  name: z
    .string()
    .min(2, 'Le nom doit faire au moins 2 caractères')
    .max(100, 'Le nom ne peut pas dépasser 100 caractères')
    .trim()
    .regex(
      /^[a-zA-ZÀ-ÿ\s\-']+$/,
      'Le nom ne peut contenir que des lettres, espaces et tirets',
    ),
  email: emailSchema,
  password: passwordSchema,
  colorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'La couleur doit être un code hexadécimal valide (ex: #6366F1)')
    .optional()
    .default('#6366F1'),
  avatarUrl: z.string().url('URL d\'avatar invalide').optional().nullable(),
});

export type RegisterDTO = z.infer<typeof RegisterSchema>;

// ── Login ─────────────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, 'Le mot de passe est requis'),
});

export type LoginDTO = z.infer<typeof LoginSchema>;

// ── Refresh Token ─────────────────────────────────────────────────────────────

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Le refresh token est requis'),
});

export type RefreshTokenDTO = z.infer<typeof RefreshTokenSchema>;

// ── Update Profile ────────────────────────────────────────────────────────────

export const UpdateProfileSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(100)
    .trim()
    .regex(/^[a-zA-ZÀ-ÿ\s\-']+$/)
    .optional(),
  colorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  avatarUrl: z.string().url().optional().nullable(),
  currentPassword: z.string().min(1).optional(),
  newPassword: passwordSchema.optional(),
}).refine(
  (data) => {
    // Si newPassword est fourni, currentPassword est obligatoire
    if (data.newPassword && !data.currentPassword) return false;
    return true;
  },
  {
    message: 'Le mot de passe actuel est requis pour en définir un nouveau',
    path: ['currentPassword'],
  },
);

export type UpdateProfileDTO = z.infer<typeof UpdateProfileSchema>;
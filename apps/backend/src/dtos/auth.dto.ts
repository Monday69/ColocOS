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
  /// Exigé quand INVITE_CODE est configuré (toujours le cas en production)
  inviteCode: z.string().trim().max(100).optional(),
  /// Code PIN choisi dès l'inscription (obligatoire en production)
  pin: z.string().regex(/^\d{4}$/, 'Le code PIN doit contenir exactement 4 chiffres').optional(),
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
  /// Identifiant de connexion (3–40 car., alphanumérique + . _ -)
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Identifiant invalide (lettres, chiffres, . _ -)')
    .optional()
    .nullable(),
  /// Mode d'authentification du profil
  authMode: z.enum(['AUTO_DEVICE', 'PIN_ONLY', 'USERNAME_PIN']).optional(),
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

// ── Sélecteur de profils & PIN ────────────────────────────────────────────────

const pinSchema = z
  .string()
  .regex(/^\d{4}$/, 'Le code PIN doit contenir exactement 4 chiffres');

export const LoginPinSchema = z.object({
  userId: z.string().uuid('userId doit être un UUID valide'),
  pin: pinSchema,
  /// Exigé quand le profil est en `USERNAME_PIN`
  username: z.string().trim().max(40).optional(),
});

export const DeviceLoginSchema = z.object({
  userId: z.string().uuid('userId doit être un UUID valide'),
});

export type LoginPinDTO = z.infer<typeof LoginPinSchema>;

export const SetupPinSchema = z.object({
  userId: z.string().uuid('userId doit être un UUID valide'),
  pin: pinSchema,
  email: emailSchema.optional(),
  /// Mot de passe du compte : exigé en production sans session active,
  /// sinon n'importe qui pourrait poser son PIN sur un profil encore vierge
  password: z.string().min(1).max(200).optional(),
});

export type SetupPinDTO = z.infer<typeof SetupPinSchema>;

export const UpdatePinSchema = z.object({
  pin: pinSchema,
  currentPin: pinSchema.optional(),
});

export type UpdatePinDTO = z.infer<typeof UpdatePinSchema>;

// ── Inscription sur demande ─────────────────────────────────────────────────

export const RequestInviteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Le prénom doit contenir au moins 2 caractères')
    .max(100, 'Le prénom ne peut pas dépasser 100 caractères')
    .regex(/^[a-zA-ZÀ-ÿ\s\-']+$/, 'Le prénom contient des caractères invalides'),
  email: emailSchema,
  /** Champ piège : rempli par les robots, doit rester vide. */
  website: z.string().max(0).optional(),
});

export type RequestInviteDTO = z.infer<typeof RequestInviteSchema>;
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),

  // ── JWT ──────────────────────────────────────────────────────────────────────
  // Deux secrets distincts : compromission d'un seul ne suffit pas à forger les deux types de tokens
  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit faire au moins 32 caractères'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET doit faire au moins 32 caractères'),
  // Access token court (15min), refresh token long (30j) — configurables
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // ── Services externes ─────────────────────────────────────────────────────
  REDIS_URL: z.string().optional(),
  OPENFOODFACTS_BASE_URL: z
    .string()
    .url()
    .default('https://world.openfoodfacts.org/api/v2'),
  SPOONACULAR_API_KEY: z.string().optional(),
  EXPIRY_ALERT_THRESHOLD_DAYS: z.coerce.number().int().default(7),

  // ── CORS ──────────────────────────────────────────────────────────────────
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  /// Base publique de l'API (liens magiques NFC, partages)
  PUBLIC_API_URL: z.string().default('http://localhost/api'),

  // ── Web Push (PWA) ────────────────────────────────────────────────────────
  // Optionnels : sans ces clés l'API démarre normalement, le service push
  // se contente de désactiver l'envoi (logs explicites) au lieu de planter.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:contact@colocos.local'),

  // ── Balance connectée (Xiaomi / Mi Body Composition) ──────────────────────
  // Protège POST /api/profile/weigh-in : la balance ne porte pas de JWT.
  SCALE_DEVICE_KEY: z.string().min(8).default('colocos_scale_device_key'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables d\'environnement invalides:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
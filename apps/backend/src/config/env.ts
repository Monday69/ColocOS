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

  // ── Web Push (PWA) ────────────────────────────────────────────────────────
  // Optionnels : sans ces clés l'API démarre normalement, le service push
  // se contente de désactiver l'envoi (logs explicites) au lieu de planter.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:contact@colocos.local'),

  // ── Balance connectée (Xiaomi / Mi Body Composition) ──────────────────────
  // Protège POST /api/profile/weigh-in : la balance ne porte pas de JWT.
  SCALE_DEVICE_KEY: z.string().min(8).default('colocos_scale_device_key'),

  // ── Pont Jarvis Runner (séances & planning) ───────────────────────────────
  JARVIS_INTEGRATION_KEY: z.string().min(8).default('colocos_jarvis_integration_key'),
  /// Optionnel : sans URL, /upcoming répond `available: false` sans erreur
  // `docker compose` injecte une chaîne vide quand la variable n'est pas
  // définie : on la ramène à `undefined` pour ne pas invalider le schéma.
  JARVIS_API_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),

  // ── Borne NFC (Hybrid-Pay) ────────────────────────────────────────────────
  // Protège POST /api/finance/settle-nfc (header X-Terminal-Secret).
  // Obligatoire en production, optionnel en développement.
  TERMINAL_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(16, 'TERMINAL_SECRET doit faire au moins 16 caractères').optional(),
  ),

  // ── Code d'invitation ─────────────────────────────────────────────────────
  // Exigé par POST /api/auth/register. Obligatoire en production : sans lui,
  // n'importe qui connaissant l'URL publique pourrait rejoindre la coloc.
  INVITE_CODE: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(8, 'INVITE_CODE doit faire au moins 8 caractères').optional(),
  ),

  // ── Emails d'invitation (Resend) ──────────────────────────────────────────
  // Toutes optionnelles : sans clé, l'API continue de fonctionner et se
  // contente de journaliser le lien d'approbation et le code généré.
  RESEND_API_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(10, 'RESEND_API_KEY invalide').optional(),
  ),
  MAIL_FROM: z.string().default('ColocOS <noreply@example.com>'),
  ADMIN_EMAIL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().email('ADMIN_EMAIL doit être un email valide').optional(),
  ),

  // ── Reverse proxies ───────────────────────────────────────────────────────
  // Nombre de proxys de confiance devant l'API (Express `trust proxy`), pour
  // que le rate limiting et les logs voient l'IP réelle du client.
  // Défaut : 2 en production (Caddy global + Caddy du conteneur web), 0 sinon.
  // Une valeur trop haute permet d'usurper l'IP via X-Forwarded-For.
  TRUST_PROXY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().min(0).max(10).optional(),
  ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables d\'environnement invalides:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// ── Garde-fou production ──────────────────────────────────────────────────
// Les clés machine ont des valeurs par défaut pour le développement local.
// En production, les laisser telles quelles revient à publier la clé : on
// refuse de démarrer plutôt que d'exposer une API ouverte.
const INSECURE_DEFAULTS: Array<[string, string]> = [
  ['SCALE_DEVICE_KEY', 'colocos_scale_device_key'],
  ['JARVIS_INTEGRATION_KEY', 'colocos_jarvis_integration_key'],
  // Anciennes valeurs par défaut du docker-compose : publiques, donc inutilisables
  ['JWT_SECRET', 'colocos_dev_jwt_secret_change_me_0123456789'],
  ['JWT_REFRESH_SECRET', 'colocos_dev_refresh_secret_change_me_0123456789'],
];

// Secrets sans valeur par défaut mais indispensables dès que l'API est exposée
const REQUIRED_IN_PRODUCTION = ['TERMINAL_SECRET', 'INVITE_CODE'] as const;

if (parsed.data.NODE_ENV === 'production') {
  const insecure = INSECURE_DEFAULTS.filter(
    ([key, value]) => parsed.data[key as keyof typeof parsed.data] === value,
  ).map(([key]) => key);

  if (insecure.length > 0) {
    console.error(
      `❌ Clés machine par défaut en production : ${insecure.join(', ')} — définis-les dans l'environnement.`,
    );
    process.exit(1);
  }

  if (parsed.data.JWT_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    console.error('❌ JWT_SECRET et JWT_REFRESH_SECRET doivent être différents en production.');
    process.exit(1);
  }

  const missing = REQUIRED_IN_PRODUCTION.filter((key) => !parsed.data[key]);
  if (missing.length > 0) {
    console.error(
      `❌ Variables obligatoires en production manquantes : ${missing.join(', ')}.`,
    );
    process.exit(1);
  }
}

export const env = parsed.data;
export type Env = typeof env;
-- ColocOS — Initialisation PostgreSQL
-- Exécuté automatiquement par Docker au premier démarrage

-- Extension UUID (nécessaire pour gen_random_uuid si Prisma l'utilise)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Pour les recherches textuelles floues sur les recettes/items

-- Timezone par défaut
SET timezone = 'Europe/Paris';
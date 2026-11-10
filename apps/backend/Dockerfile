# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# ColocOS — API (Express + Prisma)
# Contexte de build : racine du monorepo (voir docker-compose.yml)
# ─────────────────────────────────────────────────────────────────────────────

# ── 1. Dépendances + compilation ─────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# openssl est requis par le moteur Prisma
RUN apk add --no-cache openssl

# Manifests d'abord : la couche npm ci est réutilisée tant que le lockfile
# ne change pas (les sources arrivent après).
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/

RUN npm ci --workspace=apps/backend --include-workspace-root

# Sources backend (prisma + src + tsconfig)
COPY apps/backend apps/backend

RUN npx prisma generate --schema apps/backend/prisma/schema.prisma \
 && npm run build --workspace=apps/backend

# ── 2. Image d'exécution ─────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001

RUN apk add --no-cache openssl curl

# Dépendances de production uniquement
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/

RUN npm ci --omit=dev --workspace=apps/backend --include-workspace-root \
 && npm install --global prisma@5.22.0 \
 && npm cache clean --force

# Client Prisma généré par le builder (les binaires du moteur sont dedans)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Code compilé + schéma (utilisé par `prisma db push` au démarrage)
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY apps/backend/prisma ./apps/backend/prisma
COPY apps/backend/docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3001

HEALTHCHECK --interval=20s --timeout=5s --start-period=25s --retries=5 \
  CMD curl -fsS http://localhost:3001/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]

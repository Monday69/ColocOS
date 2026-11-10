# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# ColocOS — Frontend (Vite PWA) servi par Caddy
# Contexte de build : racine du monorepo (voir docker-compose.yml)
# ─────────────────────────────────────────────────────────────────────────────

# ── 1. Build Vite ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/package.json apps/backend/

RUN npm ci --workspace=apps/frontend --include-workspace-root

COPY apps/frontend apps/frontend

# Variables injectées au build (Vite les fige dans le bundle)
ARG VITE_API_URL=/api
ARG VITE_VAPID_PUBLIC_KEY=
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_VAPID_PUBLIC_KEY=${VITE_VAPID_PUBLIC_KEY}

RUN npm run build --workspace=apps/frontend

# ── 2. Caddy + assets statiques ─────────────────────────────────────────────
FROM caddy:2-alpine AS runner

# Le Caddyfile est monté depuis la racine du dépôt (contexte = racine)
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/apps/frontend/dist /srv

EXPOSE 80 443

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q --spider http://localhost:80/ || exit 1

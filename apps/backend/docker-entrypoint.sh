#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# ColocOS — démarrage du conteneur API
# 1. attend que PostgreSQL accepte les connexions (via `prisma db push`)
# 2. synchronise le schéma (idempotent)
# 3. lance le serveur Node
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCHEMA="/app/apps/backend/prisma/schema.prisma"
MAX_ATTEMPTS="${DB_WAIT_ATTEMPTS:-30}"

echo "[entrypoint] Attente de PostgreSQL (max $((MAX_ATTEMPTS * 2))s)…"

attempt=1
until prisma db push --schema="$SCHEMA" --skip-generate >/tmp/prisma-push.log 2>&1; do
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "[entrypoint] PostgreSQL injoignable après $attempt tentatives :"
    cat /tmp/prisma-push.log
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done

echo "[entrypoint] Schéma Prisma synchronisé."
tail -n 2 /tmp/prisma-push.log || true

echo "[entrypoint] Démarrage de l'API sur le port ${PORT:-3001}…"
exec node apps/backend/dist/src/server.js

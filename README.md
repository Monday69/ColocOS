# ColocOS 🏠

> Application de gestion de colocation avec Digital Twin 3D

## Stack Technique

| Couche | Technologie |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Three.js/R3F + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| ORM | Prisma 5 |
| Base de données | PostgreSQL 16 |
| Cache | Redis 7 |
| Containerisation | Docker + Docker Compose |

## Démarrage rapide

### 1. Prérequis
- Node.js ≥ 20
- Docker + Docker Compose

### 2. Configuration
```bash
cp .env.example .env
# Éditez .env si nécessaire
```

### 3. Lancer la base de données
```bash
docker compose up -d postgres redis
```

### 4. Initialiser le backend
```bash
cd apps/backend
npm install
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

### 5. Vérifier
```
GET http://localhost:3001/api/health
```

### 6. pgAdmin (optionnel)
```bash
docker compose --profile tools up -d pgadmin
# Ouvrir http://localhost:5050
```

## Structure du Monorepo

```
colocos/
├── apps/
│   ├── backend/              # API Express + TypeScript
│   │   ├── prisma/
│   │   │   ├── schema.prisma # Schéma BDD complet
│   │   │   └── seed.ts       # Données de démonstration
│   │   └── src/
│   │       ├── config/       # Prisma, Logger, Env
│   │       ├── middlewares/  # Auth JWT, Error handler
│   │       ├── routes/       # Endpoints API
│   │       ├── controllers/  # Logique des routes
│   │       ├── services/     # Business logic
│   │       └── types/        # Types partagés TS
│   └── frontend/             # React + Three.js (sprint 2)
├── packages/
│   └── shared/               # Types partagés Back↔Front
├── docker-compose.yml
└── .env.example
```

## Endpoints disponibles

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/health` | Santé du serveur + BDD |

*Les autres routes seront ajoutées par sprint.*

## Commandes utiles

```bash
# BDD
npm run db:migrate      # Appliquer les migrations
npm run db:studio       # Ouvrir Prisma Studio (GUI BDD)
npm run db:seed         # Injecter les données de démo

# Dev
npm run dev:backend     # Démarrer le backend (hot reload)
npm run dev:frontend    # Démarrer le frontend
npm run dev             # Les deux en parallèle
```
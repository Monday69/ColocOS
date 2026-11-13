import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Pont Jarvis Runner
//
//  • POST /api/integrations/jarvis/workout  → séance terminée (webhook signé)
//  • GET  /api/integrations/jarvis/upcoming → planning J+1 (recharge glucidique)
//
// Aucune dépendance dure : si Jarvis est absent ou `JARVIS_API_URL` non
// configurée, `upcoming` répond `{ available: false }` sans jamais lever 500.
// ─────────────────────────────────────────────────────────────────────────────

export const SPORT_TYPES = ['RUN', 'BIKE', 'CLIMB', 'STRENGTH', 'OTHER'] as const;
export const INTENSITY_TYPES = ['RECOVERY', 'ENDURANCE', 'THRESHOLD', 'VO2MAX', 'RACE'] as const;

/** Ventilation du bonus calorique d'une séance. */
export const WORKOUT_BONUS_SPLIT = { carbs: 0.65, protein: 0.2, fat: 0.15 } as const;

export interface WorkoutPayload {
  userId?: string;
  username?: string;
  externalId?: string;
  sportType: string;
  title?: string;
  durationMin: number;
  activeKcal: number;
  triScore?: number;
  intensityType?: string;
  performedAt?: string;
}

export interface WorkoutRecord {
  id: string;
  userId: string;
  externalId: string | null;
  sportType: string;
  title: string | null;
  durationMin: number;
  activeKcal: number;
  triScore: number | null;
  intensityType: string | null;
  performedAt: string;
}

function toRecord(row: {
  id: string;
  userId: string;
  externalId: string | null;
  sportType: string;
  title: string | null;
  durationMin: number;
  activeKcal: number;
  triScore: number | null;
  intensityType: string | null;
  performedAt: Date;
}): WorkoutRecord {
  return {
    id: row.id,
    userId: row.userId,
    externalId: row.externalId,
    sportType: row.sportType,
    title: row.title,
    durationMin: row.durationMin,
    activeKcal: row.activeKcal,
    triScore: row.triScore,
    intensityType: row.intensityType,
    performedAt: row.performedAt.toISOString(),
  };
}

/** Ventile un bonus calorique en grammes de macros (65 / 20 / 15). */
export function splitWorkoutBonus(activeKcal: number): {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
} {
  const kcal = Math.max(0, Math.round(activeKcal));
  return {
    kcal,
    carbsG: Math.round((kcal * WORKOUT_BONUS_SPLIT.carbs) / 4),
    proteinG: Math.round((kcal * WORKOUT_BONUS_SPLIT.protein) / 4),
    fatG: Math.round((kcal * WORKOUT_BONUS_SPLIT.fat) / 9),
  };
}

export class IntegrationsService {
  /** Vérifie la clé partagée avec Jarvis Runner. */
  assertIntegrationKey(provided: string | undefined): void {
    const expected = env.JARVIS_INTEGRATION_KEY;
    if (!expected || !provided || provided !== expected) {
      throw new AppError(401, "Clé d'intégration invalide.");
    }
  }

  /** Enregistre (ou met à jour) une séance importée. */
  async upsertWorkout(payload: WorkoutPayload): Promise<WorkoutRecord> {
    if (!SPORT_TYPES.includes(payload.sportType as (typeof SPORT_TYPES)[number])) {
      throw new AppError(400, `sportType invalide (${SPORT_TYPES.join(', ')}).`);
    }
    if (
      payload.intensityType &&
      !INTENSITY_TYPES.includes(payload.intensityType as (typeof INTENSITY_TYPES)[number])
    ) {
      throw new AppError(400, `intensityType invalide (${INTENSITY_TYPES.join(', ')}).`);
    }
    if (!Number.isFinite(payload.durationMin) || payload.durationMin <= 0) {
      throw new AppError(400, 'durationMin doit être un entier positif.');
    }
    if (!Number.isFinite(payload.activeKcal) || payload.activeKcal < 0) {
      throw new AppError(400, 'activeKcal doit être un nombre positif.');
    }

    // Résolution de l'utilisateur : id explicite, sinon identifiant, sinon erreur
    const user = payload.userId
      ? await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true } })
      : payload.username
        ? await prisma.user.findUnique({
            where: { username: payload.username.toLowerCase() },
            select: { id: true },
          })
        : null;

    if (!user) {
      throw new AppError(404, 'Utilisateur introuvable (userId ou username requis).');
    }

    const performedAt = payload.performedAt ? new Date(payload.performedAt) : new Date();
    if (Number.isNaN(performedAt.getTime())) {
      throw new AppError(400, 'performedAt invalide (ISO 8601 attendu).');
    }

    const data = {
      userId: user.id,
      sportType: payload.sportType,
      title: payload.title?.slice(0, 160) ?? null,
      durationMin: Math.round(payload.durationMin),
      activeKcal: Math.round(payload.activeKcal),
      triScore: typeof payload.triScore === 'number' ? payload.triScore : null,
      intensityType: payload.intensityType ?? null,
      performedAt,
    };

    // Idempotence : même `externalId` → mise à jour, pas de doublon
    const row = payload.externalId
      ? await prisma.workoutSync.upsert({
          where: { externalId: payload.externalId },
          create: { ...data, externalId: payload.externalId },
          update: data,
        })
      : await prisma.workoutSync.create({ data });

    logger.info(
      `[Jarvis] Séance ${data.sportType} ${data.durationMin} min / ${data.activeKcal} kcal → ${user.id}`,
    );

    return toRecord(row);
  }

  /**
   * Produits en stock les plus pertinents pour la récupération :
   * riches en protéines et proches de la DLC.
   */
  async recoverySuggestions(userId: string, limit = 3) {
    const items = await prisma.item.findMany({
      where: { consumedAt: null, proteins: { not: null } },
      include: { storageZone: { select: { label: true } } },
      orderBy: [{ proteins: 'desc' }, { expiryDate: 'asc' }],
      take: limit,
    });

    return items.map((item) => ({
      id: item.id,
      name: item.name,
      brand: item.brand,
      proteins: item.proteins,
      calories: item.calories,
      quantity: Number(item.quantity),
      unit: item.unit,
      expiryDate: item.expiryDate ? item.expiryDate.toISOString().slice(0, 10) : null,
      zoneLabel: item.storageZone.label,
      ownerId: item.ownerId,
      mine: item.ownerId === userId,
    }));
  }

  /**
   * Planning d'entraînement de demain.
   *
   * Contrat attendu de Jarvis Runner :
   *   GET {JARVIS_API_URL}/planning/tomorrow?userId=<id>
   *   → { workouts: [{ sportType, title?, durationMin, intensityType? }] }
   *
   * Toute indisponibilité est absorbée : `available: false`.
   */
  async upcoming(userId: string) {
    const baseUrl = env.JARVIS_API_URL;

    if (!baseUrl) {
      return {
        available: false,
        carbLoadRecommended: false,
        reason: 'JARVIS_API_URL non configurée',
        workouts: [],
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);

      const response = await fetch(
        `${baseUrl.replace(/\/$/, '')}/planning/tomorrow?userId=${encodeURIComponent(userId)}`,
        { signal: controller.signal, headers: { Accept: 'application/json' } },
      ).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        return {
          available: false,
          carbLoadRecommended: false,
          reason: `Jarvis a répondu ${response.status}`,
          workouts: [],
        };
      }

      const payload = (await response.json()) as {
        workouts?: Array<{
          sportType?: string;
          title?: string;
          durationMin?: number;
          intensityType?: string;
        }>;
      };

      const workouts = (payload.workouts ?? []).map((workout) => ({
        sportType: workout.sportType ?? 'OTHER',
        title: workout.title ?? null,
        durationMin: Number(workout.durationMin ?? 0),
        intensityType: workout.intensityType ?? null,
      }));

      const carbLoadRecommended = workouts.some(
        (workout) =>
          workout.durationMin >= 75 ||
          ['THRESHOLD', 'VO2MAX', 'RACE'].includes(workout.intensityType ?? ''),
      );

      return { available: true, carbLoadRecommended, workouts };
    } catch (err) {
      logger.warn(`[Jarvis] Planning indisponible : ${String(err)}`);
      return {
        available: false,
        carbLoadRecommended: false,
        reason: 'Jarvis injoignable',
        workouts: [],
      };
    }
  }

  /** Séances du jour pour un utilisateur (alimente le budget calorique). */
  async workoutsToday(userId: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const rows = await prisma.workoutSync.findMany({
      where: { userId, performedAt: { gte: start, lt: end } },
      orderBy: { performedAt: 'desc' },
    });

    return rows.map(toRecord);
  }
}

export const integrationsService = new IntegrationsService();

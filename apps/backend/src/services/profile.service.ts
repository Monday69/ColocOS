import { ProfileGoal } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Profil athlète (biométrie, cibles macros, pesées, journal)
//
// Les formules sont pures et exportées séparément du service : Mifflin-St Jeor
// pour le métabolisme de base, facteur d'activité pour le TDEE, puis un delta
// calorique et une répartition macros selon l'objectif.
// ─────────────────────────────────────────────────────────────────────────────

export type Sex = 'M' | 'F';

/** Delta calorique appliqué au TDEE selon l'objectif. */
export const GOAL_DELTA: Record<ProfileGoal, number> = {
  MAINTAIN: 0,
  BULK: 300,
  CUT: -400,
  CARB_LOAD: 450,
};

/** Protéines en g/kg de poids de corps (fourchette 1.8–2.0 selon l'objectif). */
export const GOAL_PROTEIN_PER_KG: Record<ProfileGoal, number> = {
  MAINTAIN: 1.8,
  BULK: 2.0,
  CUT: 2.0,
  CARB_LOAD: 1.8,
};

/** Lipides en g/kg. */
export const FAT_PER_KG = 0.9;

export interface TargetsInput {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  activityFactor: number;
  goal: ProfileGoal;
}

export interface Targets {
  bmr: number;
  tdee: number;
  targetKcal: number;
  targetProtein: number;
  targetCarbs: number;
  targetFat: number;
}

export function computeAge(birthDate: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return Math.max(14, Math.min(100, age));
}

/**
 * Mifflin-St Jeor :
 *   BMR = 10·poids + 6,25·taille − 5·âge + (sexe M ? +5 : −161)
 */
export function computeBmr(input: Pick<TargetsInput, 'weightKg' | 'heightCm' | 'age' | 'sex'>): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age;
  return Math.round(base + (input.sex === 'M' ? 5 : -161));
}

/** Cibles journalières : TDEE ± delta, protéines/lipides en g/kg, glucides en reste. */
export function computeTargets(input: TargetsInput): Targets {
  const bmr = computeBmr(input);
  const tdee = Math.round(bmr * input.activityFactor);
  const targetKcal = Math.max(1200, Math.round(tdee + GOAL_DELTA[input.goal]));

  const targetProtein = Math.round(input.weightKg * GOAL_PROTEIN_PER_KG[input.goal]);
  const targetFat = Math.round(input.weightKg * FAT_PER_KG);

  // Glucides = calories restantes après protéines (4 kcal/g) et lipides (9 kcal/g)
  const remaining = targetKcal - targetProtein * 4 - targetFat * 9;
  const targetCarbs = Math.max(0, Math.round(remaining / 4));

  return { bmr, tdee, targetKcal, targetProtein, targetCarbs, targetFat };
}

// ── Impédancemétrie (BIA) ───────────────────────────────────────────────────

/**
 * Composition corporelle — équation de la Xiaomi Mi Body Composition Scale 2
 * (`XMTZC05HM`), réputée plus juste que Kyle sans réactance sur cet appareil.
 *
 *   LBM = (H·9,058/100)·(H/100) + W·0,32 + 12,226 − R·0,0068 − âge·0,0542
 *   avec ajustement de sexe (M : +0,8 / F : −0,8 puis −9,25 sur petit gabarit)
 *
 * `impedanceOhm` doit être dans la plage physique de la balance (300–1200 Ω) :
 * hors bornes la mesure est rejetée (l'appareil renvoie souvent 0 quand les
 * pieds sont mal posés).
 */
export const IMPEDANCE_MIN_OHM = 300;
export const IMPEDANCE_MAX_OHM = 1200;

export function computeBodyComposition(input: {
  weightKg: number;
  heightCm: number;
  age: number;
  impedanceOhm: number;
  sex: Sex;
}): { bodyFatPct: number; muscleMassKg: number; fatFreeMassKg: number } {
  const { weightKg, heightCm, age, impedanceOhm, sex } = input;

  if (!Number.isFinite(impedanceOhm) || impedanceOhm < IMPEDANCE_MIN_OHM || impedanceOhm > IMPEDANCE_MAX_OHM) {
    throw new AppError(
      400,
      `Impédance hors plage (${IMPEDANCE_MIN_OHM}–${IMPEDANCE_MAX_OHM} Ω) : repose les pieds sur la balance.`,
    );
  }

  const heightM = heightCm / 100;
  let lbm =
    (heightCm * 9.058) / 100 * heightM +
    weightKg * 0.32 +
    12.226 -
    impedanceOhm * 0.0068 -
    age * 0.0542;

  if (sex === 'F') {
    lbm -= 0.8;
    // Correction « petit gabarit » de la balance pour les femmes
    if (weightKg < 60) lbm -= 9.25;
  } else {
    lbm += 0.8;
  }

  // Bornes physiologiques : la masse maigre reste dans [30 %, 85 %] du poids
  const fatFreeMassKg = Math.min(Math.max(lbm, weightKg * 0.3), weightKg * 0.85);
  const bodyFatPct = Math.max(3, Math.min(60, ((weightKg - fatFreeMassKg) / weightKg) * 100));
  // Masse musculaire ≈ 52 % de la masse maigre (repère usuel en composition)
  const muscleMassKg = fatFreeMassKg * 0.52;

  return {
    bodyFatPct: Math.round(bodyFatPct * 10) / 10,
    muscleMassKg: Math.round(muscleMassKg * 10) / 10,
    fatFreeMassKg: Math.round(fatFreeMassKg * 10) / 10,
  };
}

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface ProfilePayload {
  heightCm: number;
  weightKg: number;
  birthDate: string;
  sex: Sex;
  activityFactor: number;
  goal: ProfileGoal;
}

export interface ProfileView extends ProfilePayload {
  age: number;
  bmr: number;
  tdee: number;
  targetKcal: number;
  targetProtein: number;
  targetCarbs: number;
  targetFat: number;
  updatedAt: string;
}

function toDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, 'Date de naissance invalide (format YYYY-MM-DD).');
  }
  return parsed;
}

function validate(payload: ProfilePayload): void {
  if (!Number.isFinite(payload.heightCm) || payload.heightCm < 100 || payload.heightCm > 250) {
    throw new AppError(400, 'Taille invalide (100–250 cm).');
  }
  if (!Number.isFinite(payload.weightKg) || payload.weightKg < 30 || payload.weightKg > 300) {
    throw new AppError(400, 'Poids invalide (30–300 kg).');
  }
  if (payload.sex !== 'M' && payload.sex !== 'F') {
    throw new AppError(400, 'Sexe invalide (M ou F).');
  }
  if (!Number.isFinite(payload.activityFactor) || payload.activityFactor < 1.1 || payload.activityFactor > 2.0) {
    throw new AppError(400, "Facteur d'activité invalide (1.1–2.0).");
  }
}

// ── Service ─────────────────────────────────────────────────────────────────

export class ProfileService {
  async getProfile(userId: string): Promise<ProfileView | null> {
    const row = await prisma.userProfile.findUnique({ where: { userId } });
    if (!row) return null;

    const age = computeAge(row.birthDate);
    const targets = computeTargets({
      weightKg: row.weightKg,
      heightCm: row.heightCm,
      age,
      sex: row.sex === 'F' ? 'F' : 'M',
      activityFactor: row.activityFactor,
      goal: row.goal,
    });

    return {
      heightCm: row.heightCm,
      weightKg: row.weightKg,
      birthDate: row.birthDate.toISOString().slice(0, 10),
      sex: row.sex === 'F' ? 'F' : 'M',
      activityFactor: row.activityFactor,
      goal: row.goal,
      age,
      bmr: targets.bmr,
      tdee: targets.tdee,
      targetKcal: row.targetKcal,
      targetProtein: row.targetProtein,
      targetCarbs: row.targetCarbs,
      targetFat: row.targetFat,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Crée ou met à jour le profil et recalcule les cibles persistées. */
  async upsertProfile(userId: string, payload: ProfilePayload): Promise<ProfileView> {
    validate(payload);

    const birthDate = toDate(payload.birthDate);
    const age = computeAge(birthDate);
    const targets = computeTargets({
      weightKg: payload.weightKg,
      heightCm: payload.heightCm,
      age,
      sex: payload.sex,
      activityFactor: payload.activityFactor,
      goal: payload.goal,
    });

    await prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        heightCm: Math.round(payload.heightCm),
        weightKg: payload.weightKg,
        birthDate,
        sex: payload.sex,
        activityFactor: payload.activityFactor,
        goal: payload.goal,
        targetKcal: targets.targetKcal,
        targetProtein: targets.targetProtein,
        targetCarbs: targets.targetCarbs,
        targetFat: targets.targetFat,
      },
      update: {
        heightCm: Math.round(payload.heightCm),
        weightKg: payload.weightKg,
        birthDate,
        sex: payload.sex,
        activityFactor: payload.activityFactor,
        goal: payload.goal,
        targetKcal: targets.targetKcal,
        targetProtein: targets.targetProtein,
        targetCarbs: targets.targetCarbs,
        targetFat: targets.targetFat,
      },
    });

    // Miroir sur les colonnes historiques de `users` : le HUD, les cibles
    // « legacy » et le semainier continuent de fonctionner sans divergence.
    const legacyGoal =
      payload.goal === 'CUT'
        ? 'CUT'
        : payload.goal === 'BULK'
          ? 'LEAN_BULK'
          : payload.goal === 'CARB_LOAD'
            ? 'HIGH_PROTEIN'
            : 'MAINTENANCE';

    await prisma.user.update({
      where: { id: userId },
      data: {
        heightCm: payload.heightCm,
        weightKg: payload.weightKg,
        birthDate,
        gender: payload.sex,
        activityLevel: payload.activityFactor,
        nutritionGoal: legacyGoal as never,
      },
    });

    const view = await this.getProfile(userId);
    if (!view) throw new AppError(500, 'Profil non enregistré.');
    return view;
  }

  /** Cumul du jour + cibles + détail des logs. */
  async nutritionToday(userId: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const [logs, profile, workouts] = await Promise.all([
      prisma.nutritionLog.findMany({
        where: { userId, consumedAt: { gte: start, lt: end } },
        orderBy: { consumedAt: 'desc' },
      }),
      this.getProfile(userId),
      prisma.workoutSync.findMany({
        where: { userId, performedAt: { gte: start, lt: end } },
        orderBy: { performedAt: 'desc' },
      }),
    ]);

    // Bonus sportif : les séances du jour élargissent le budget calorique et
    // sont ventilées 65 % glucides / 20 % protéines / 15 % lipides.
    const workoutBonusKcal = workouts.reduce((sum, workout) => sum + workout.activeKcal, 0);
    const bonus = {
      kcal: workoutBonusKcal,
      proteinG: Math.round((workoutBonusKcal * 0.2) / 4),
      carbsG: Math.round((workoutBonusKcal * 0.65) / 4),
      fatG: Math.round((workoutBonusKcal * 0.15) / 9),
    };

    const totals = logs.reduce(
      (acc, log) => ({
        kcal: acc.kcal + log.kcal,
        proteinG: acc.proteinG + log.proteinG,
        carbsG: acc.carbsG + log.carbsG,
        fatG: acc.fatG + log.fatG,
      }),
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    );

    const round = (value: number) => Math.round(value * 10) / 10;

    return {
      date: start.toISOString().slice(0, 10),
      consumed: {
        kcal: round(totals.kcal),
        proteinG: round(totals.proteinG),
        carbsG: round(totals.carbsG),
        fatG: round(totals.fatG),
      },
      targets: profile
        ? {
            kcal: profile.targetKcal,
            proteinG: profile.targetProtein,
            carbsG: profile.targetCarbs,
            fatG: profile.targetFat,
          }
        : null,
      // Budget effectif = cibles + séances du jour
      effective: profile
        ? {
            kcal: profile.targetKcal + bonus.kcal,
            proteinG: profile.targetProtein + bonus.proteinG,
            carbsG: profile.targetCarbs + bonus.carbsG,
            fatG: profile.targetFat + bonus.fatG,
          }
        : null,
      workoutBonus: {
        ...bonus,
        sessions: workouts.map((workout) => ({
          id: workout.id,
          sportType: workout.sportType,
          title: workout.title,
          durationMin: workout.durationMin,
          activeKcal: workout.activeKcal,
          intensityType: workout.intensityType,
          performedAt: workout.performedAt.toISOString(),
        })),
      },
      remaining: profile
        ? {
            kcal: Math.round(profile.targetKcal + bonus.kcal - totals.kcal),
            proteinG: Math.round(profile.targetProtein + bonus.proteinG - totals.proteinG),
            carbsG: Math.round(profile.targetCarbs + bonus.carbsG - totals.carbsG),
            fatG: Math.round(profile.targetFat + bonus.fatG - totals.fatG),
          }
        : null,
      logs: logs.map((log) => ({
        id: log.id,
        label: log.label,
        kcal: log.kcal,
        proteinG: log.proteinG,
        carbsG: log.carbsG,
        fatG: log.fatG,
        source: log.source,
        consumedAt: log.consumedAt.toISOString(),
      })),
    };
  }

  /**
   * Journalise une consommation (appelé par le stock et les repas).
   * Non bloquant pour l'appelant : toute erreur est avalée et loguée.
   */
  async logConsumption(input: {
    userId: string;
    label: string;
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    source: 'STOCK_ACTION' | 'MEAL' | 'MANUAL';
  }): Promise<void> {
    if (!(input.kcal > 0) && !(input.proteinG > 0)) return;

    await prisma.nutritionLog.create({
      data: {
        userId: input.userId,
        label: input.label.slice(0, 160),
        kcal: Math.round(input.kcal * 10) / 10,
        proteinG: Math.round(input.proteinG * 10) / 10,
        carbsG: Math.round(input.carbsG * 10) / 10,
        fatG: Math.round(input.fatG * 10) / 10,
        source: input.source,
      },
    });
  }

  /** Pesée : association explicite ou par poids le plus proche (±3 kg). */
  async createWeighIn(payload: {
    weightKg: number;
    impedanceOhm?: number;
    userId?: string;
  }) {
    if (!Number.isFinite(payload.weightKg) || payload.weightKg < 20 || payload.weightKg > 400) {
      throw new AppError(400, 'Poids invalide (20–400 kg).');
    }

    const profiles = await prisma.userProfile.findMany();
    if (profiles.length === 0) {
      throw new AppError(422, 'Aucun profil biométrique enregistré.');
    }

    let profile = payload.userId
      ? profiles.find((candidate) => candidate.userId === payload.userId)
      : undefined;

    if (payload.userId && !profile) {
      throw new AppError(422, 'Profil inconnu pour cette pesée.');
    }

    if (!profile) {
      const TOLERANCE_KG = 3;
      const sorted = [...profiles].sort(
        (a, b) => Math.abs(a.weightKg - payload.weightKg) - Math.abs(b.weightKg - payload.weightKg),
      );
      const best = sorted[0];
      const runnerUp = sorted[1];

      const bestDelta = Math.abs(best.weightKg - payload.weightKg);
      if (bestDelta > TOLERANCE_KG) {
        throw new AppError(422, 'Aucun profil à moins de 3 kg — pesée non attribuée.');
      }
      // Ambiguïté : deux profils à moins de 0,5 kg d'écart du poids mesuré
      if (runnerUp && Math.abs(runnerUp.weightKg - payload.weightKg) - bestDelta < 0.5) {
        throw new AppError(422, 'Pesée ambiguë : plusieurs profils sont proches. Précise `userId`.');
      }
      profile = best;
    }

    const sex: Sex = profile.sex === 'F' ? 'F' : 'M';
    const composition =
      payload.impedanceOhm && payload.impedanceOhm > 0
        ? computeBodyComposition({
            weightKg: payload.weightKg,
            heightCm: profile.heightCm,
            age: computeAge(profile.birthDate),
            impedanceOhm: payload.impedanceOhm,
            sex,
          })
        : null;

    const weighIn = await prisma.weighIn.create({
      data: {
        userId: profile.userId,
        weightKg: payload.weightKg,
        impedanceOhm: payload.impedanceOhm ?? null,
        bodyFatPct: composition?.bodyFatPct ?? null,
        muscleMassKg: composition?.muscleMassKg ?? null,
        source: 'BLE_SCALE',
      },
    });

    // Le poids du profil suit la balance, et les cibles sont recalculées.
    const targets = computeTargets({
      weightKg: payload.weightKg,
      heightCm: profile.heightCm,
      age: computeAge(profile.birthDate),
      sex,
      activityFactor: profile.activityFactor,
      goal: profile.goal,
    });

    await prisma.userProfile.update({
      where: { id: profile.id },
      data: {
        weightKg: payload.weightKg,
        targetKcal: targets.targetKcal,
        targetProtein: targets.targetProtein,
        targetCarbs: targets.targetCarbs,
        targetFat: targets.targetFat,
      },
    });

    await prisma.user.update({
      where: { id: profile.userId },
      data: { weightKg: payload.weightKg },
    });

    logger.info(
      `[Profile] Pesée ${payload.weightKg} kg → profil ${profile.userId} (${composition ? 'BIA' : 'poids seul'})`,
    );

    return {
      id: weighIn.id,
      userId: profile.userId,
      weightKg: weighIn.weightKg,
      impedanceOhm: weighIn.impedanceOhm,
      bodyFatPct: weighIn.bodyFatPct,
      muscleMassKg: weighIn.muscleMassKg,
      source: weighIn.source,
      measuredAt: weighIn.measuredAt.toISOString(),
      targets,
    };
  }

  async listWeighIns(userId: string, limit = 20) {
    const rows = await prisma.weighIn.findMany({
      where: { userId },
      orderBy: { measuredAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    return rows.map((row) => ({
      id: row.id,
      weightKg: row.weightKg,
      impedanceOhm: row.impedanceOhm,
      bodyFatPct: row.bodyFatPct,
      muscleMassKg: row.muscleMassKg,
      source: row.source,
      measuredAt: row.measuredAt.toISOString(),
    }));
  }
}

export const profileService = new ProfileService();

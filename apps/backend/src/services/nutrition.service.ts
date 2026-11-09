import { NutritionGoal } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Nutrition Service
//
// Moteur physiologique basé sur Mifflin-St Jeor :
//   BMR  = 10·poids + 6.25·taille − 5·âge + (F ? −161 : 5)
//   TDEE = BMR × facteur d'activité (1.2 → 1.9)
//   Cibles = TDEE ± delta selon l'objectif, protéines = g/kg × poids
//
// Les formules sont pures et testables (`computeTargets`), le service ne fait
// que charger/persister le profil.
// ─────────────────────────────────────────────────────────────────────────────

/** Âge utilisé quand la date de naissance n'est pas renseignée. */
export const DEFAULT_AGE = 22;
/** Replis biométriques quand le profil est incomplet (cibles « estimées »). */
export const DEFAULT_HEIGHT_CM = 175;
export const DEFAULT_WEIGHT_KG = 70;

export interface GoalConfig {
  calorieDelta: number;
  proteinPerKg: number;
  label: string;
}

export const GOAL_CONFIG: Record<NutritionGoal, GoalConfig> = {
  MAINTENANCE: { calorieDelta: 0, proteinPerKg: 1.4, label: 'Maintien' },
  LEAN_BULK: { calorieDelta: 300, proteinPerKg: 1.8, label: 'Prise de muscle' },
  CUT: { calorieDelta: -400, proteinPerKg: 2.0, label: 'Sèche' },
  HIGH_PROTEIN: { calorieDelta: 0, proteinPerKg: 2.2, label: 'Haute teneur en protéines' },
};

export type Gender = 'M' | 'F';

export interface BiometricInput {
  birthDate: Date | null;
  heightCm: number | null;
  weightKg: number | null;
  gender: string | null;
  activityLevel: number;
  nutritionGoal: NutritionGoal;
}

export interface BiometricProfile {
  birthDate: string | null;
  age: number;
  heightCm: number | null;
  weightKg: number | null;
  gender: Gender | null;
  activityLevel: number;
  nutritionGoal: NutritionGoal;
}

export interface NutritionTargets {
  bmr: number;
  tdee: number;
  targetCalories: number;
  targetProteins: number;
  goal: NutritionGoal;
  goalLabel: string;
  proteinPerKg: number;
  profile: BiometricProfile;
  /** `true` si au moins un champ biométrique manquait (repli appliqué) */
  estimated: boolean;
  missingFields: string[];
}

// ── Calculs purs ──────────────────────────────────────────────────────────────

/** Âge en années révolues, `DEFAULT_AGE` si la date est absente/invalide. */
export function computeAge(birthDate: Date | null, now: Date = new Date()): number {
  if (!birthDate || Number.isNaN(birthDate.getTime())) return DEFAULT_AGE;

  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDelta = now.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return age >= 0 && age <= 120 ? age : DEFAULT_AGE;
}

/** Facteur d'activité borné à la plage physiologique 1.2 → 1.9. */
export function clampActivityLevel(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 1.2;
  return Math.min(1.9, Math.max(1.2, value));
}

export function normalizeGender(value: string | null | undefined): Gender | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  if (upper === 'F' || upper === 'FEMALE' || upper === 'FEMME') return 'F';
  if (upper === 'M' || upper === 'MALE' || upper === 'HOMME') return 'M';
  return null;
}

/** Mifflin-St Jeor (kcal/jour). */
export function computeBmr(input: {
  weightKg: number;
  heightCm: number;
  age: number;
  gender: Gender | null;
}): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age;
  return base + (input.gender === 'F' ? -161 : 5);
}

/**
 * Calcule toutes les cibles à partir du profil.
 * Fonction pure : aucune I/O, entièrement testable.
 */
export function computeTargets(input: BiometricInput, now: Date = new Date()): NutritionTargets {
  const missingFields: string[] = [];

  const age = computeAge(input.birthDate, now);
  if (!input.birthDate) missingFields.push('birthDate');

  const weightKg = input.weightKg && input.weightKg > 0 ? input.weightKg : DEFAULT_WEIGHT_KG;
  if (!input.weightKg) missingFields.push('weightKg');

  const heightCm = input.heightCm && input.heightCm > 0 ? input.heightCm : DEFAULT_HEIGHT_CM;
  if (!input.heightCm) missingFields.push('heightCm');

  const gender = normalizeGender(input.gender);
  if (!gender) missingFields.push('gender');

  const activityLevel = clampActivityLevel(input.activityLevel);
  const goal = input.nutritionGoal;
  const config = GOAL_CONFIG[goal] ?? GOAL_CONFIG.MAINTENANCE;

  const bmr = computeBmr({ weightKg, heightCm, age, gender });
  const tdee = bmr * activityLevel;
  const targetCalories = tdee + config.calorieDelta;
  const targetProteins = config.proteinPerKg * weightKg;

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    targetCalories: Math.round(targetCalories),
    targetProteins: Math.round(targetProteins),
    goal,
    goalLabel: config.label,
    proteinPerKg: config.proteinPerKg,
    profile: {
      birthDate: input.birthDate ? input.birthDate.toISOString().split('T')[0] : null,
      age,
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      gender,
      activityLevel,
      nutritionGoal: goal,
    },
    estimated: missingFields.length > 0,
    missingFields,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  colorHex: true,
  avatarUrl: true,
  birthDate: true,
  heightCm: true,
  weightKg: true,
  gender: true,
  activityLevel: true,
  nutritionGoal: true,
} as const;

export interface UserProfileDTO {
  id: string;
  name: string;
  email: string;
  colorHex: string;
  avatarUrl: string | null;
  birthDate: string | null;
  heightCm: number | null;
  weightKg: number | null;
  gender: Gender | null;
  activityLevel: number;
  nutritionGoal: NutritionGoal;
}

/** Ligne User telle que sélectionnée par `PROFILE_SELECT`. */
interface ProfileRow {
  id: string;
  name: string;
  email: string;
  colorHex: string;
  avatarUrl: string | null;
  birthDate: Date | null;
  heightCm: number | null;
  weightKg: number | null;
  gender: string | null;
  activityLevel: number;
  nutritionGoal: NutritionGoal;
}

export interface UpdateProfileInput {
  birthDate?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  gender?: string | null;
  activityLevel?: number;
  nutritionGoal?: NutritionGoal;
}

export class NutritionService {
  private async loadUser(userId: string): Promise<ProfileRow> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_SELECT,
    });

    if (!user) throw new AppError(404, 'Utilisateur introuvable.');
    return user;
  }

  private toProfileDTO(user: ProfileRow): UserProfileDTO {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      colorHex: user.colorHex,
      avatarUrl: user.avatarUrl,
      birthDate: user.birthDate ? user.birthDate.toISOString().split('T')[0] : null,
      heightCm: user.heightCm,
      weightKg: user.weightKg,
      gender: normalizeGender(user.gender),
      activityLevel: user.activityLevel,
      nutritionGoal: user.nutritionGoal,
    };
  }

  async getProfile(userId: string): Promise<UserProfileDTO> {
    return this.toProfileDTO(await this.loadUser(userId));
  }

  /** Cibles calculées pour l'utilisateur (BMR, TDEE, kcal et protéines). */
  async getTargets(userId: string): Promise<NutritionTargets> {
    const user = await this.loadUser(userId);

    return computeTargets({
      birthDate: user.birthDate,
      heightCm: user.heightCm,
      weightKg: user.weightKg,
      gender: user.gender,
      activityLevel: user.activityLevel,
      nutritionGoal: user.nutritionGoal,
    });
  }

  /**
   * Met à jour la biométrie / l'objectif, puis renvoie le profil ET les cibles
   * recalculées : le front n'a pas à redemander un second aller-retour.
   */
  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<{ profile: UserProfileDTO; targets: NutritionTargets }> {
    const data: {
      birthDate?: Date | null;
      heightCm?: number | null;
      weightKg?: number | null;
      gender?: string | null;
      activityLevel?: number;
      nutritionGoal?: NutritionGoal;
    } = {};

    if (input.birthDate !== undefined) {
      if (input.birthDate === null) {
        data.birthDate = null;
      } else {
        const parsed = new Date(input.birthDate);
        if (Number.isNaN(parsed.getTime())) {
          throw new AppError(400, 'Date de naissance invalide (format ISO attendu).');
        }
        if (parsed > new Date()) {
          throw new AppError(400, 'La date de naissance ne peut pas être dans le futur.');
        }
        data.birthDate = parsed;
      }
    }

    if (input.heightCm !== undefined) data.heightCm = input.heightCm;
    if (input.weightKg !== undefined) data.weightKg = input.weightKg;

    if (input.gender !== undefined) {
      const gender = normalizeGender(input.gender);
      if (input.gender !== null && gender === null) {
        throw new AppError(400, 'Genre invalide : « M » ou « F ».');
      }
      data.gender = gender;
    }

    if (input.activityLevel !== undefined) data.activityLevel = clampActivityLevel(input.activityLevel);
    if (input.nutritionGoal !== undefined) data.nutritionGoal = input.nutritionGoal;

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: PROFILE_SELECT,
    });

    logger.debug(
      `[Nutrition] Profil mis à jour (${userId}) — objectif ${updated.nutritionGoal}, ` +
        `${updated.weightKg ?? '?'} kg / ${updated.heightCm ?? '?'} cm`,
    );

    return {
      profile: this.toProfileDTO(updated),
      targets: computeTargets({
        birthDate: updated.birthDate,
        heightCm: updated.heightCm,
        weightKg: updated.weightKg,
        gender: updated.gender,
        activityLevel: updated.activityLevel,
        nutritionGoal: updated.nutritionGoal,
      }),
    };
  }
}

export const nutritionService = new NutritionService();

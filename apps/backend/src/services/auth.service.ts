import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';
import { RegisterDTO, LoginDTO, UpdateProfileDTO } from '../dtos/auth.dto';
import { AuthUser, JwtPayload } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Auth Service
//
// SÉCURITÉ :
//   - bcrypt cost factor 12 (bon équilibre sécurité/perf en 2024)
//   - JWT access token : 15min (courte durée, minimise la fenêtre de compromission)
//   - JWT refresh token : 30j (stocké côté client, HttpOnly cookie recommandé)
//   - Timing-safe compare : bcrypt.compare() est résistant aux timing attacks
//   - Message d'erreur unifié sur login : "Identifiants invalides" (pas
//     "email inconnu" ou "mauvais mot de passe" — évite l'énumération d'emails)
// ─────────────────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;

// Projection sécurisée : exclut systématiquement le hash du mot de passe
export type SafeUser = Omit<User, 'password'>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // secondes
}

export interface LoginResult {
  user: AuthUser;
  tokens: AuthTokens;
}

// ── Helpers privés ────────────────────────────────────────────────────────────

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    colorHex: user.colorHex,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class AuthService {
  /**
   * Inscription d'un nouveau colocataire.
   *
   * @throws AppError(409) si l'email est déjà utilisé
   */
  async register(data: RegisterDTO): Promise<LoginResult> {
    // ── Vérification unicité email ────────────────────────────────────────────
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true }, // Select minimal pour la vérification
    });

    if (existingUser) {
      throw new AppError(
        409,
        'Un compte existe déjà avec cette adresse email.',
      );
    }

    // ── Hachage du mot de passe ───────────────────────────────────────────────
    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    // ── Création utilisateur ──────────────────────────────────────────────────
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: hashedPassword,
        colorHex: data.colorHex,
        avatarUrl: data.avatarUrl ?? null,
      },
    });

    // ── Log d'activité ────────────────────────────────────────────────────────
    await prisma.activityLog.create({
      data: {
        action: 'USER_JOINED',
        userId: user.id,
        meta: { name: user.name, email: user.email },
      },
    });

    logger.info(`[Auth] Nouvel utilisateur inscrit : ${user.email} (id: ${user.id})`);

    const tokens = this.generateTokens(user);

    return { user: toAuthUser(user), tokens };
  }

  /**
   * Connexion d'un utilisateur existant.
   *
   * SÉCURITÉ : Le message d'erreur est volontairement identique pour un email
   * inconnu et un mot de passe incorrect — empêche l'énumération des emails.
   *
   * @throws AppError(401) si les identifiants sont invalides
   */
  async login(data: LoginDTO): Promise<LoginResult> {
    const GENERIC_ERROR = 'Identifiants invalides.';

    // ── Recherche utilisateur ─────────────────────────────────────────────────
    const user = await prisma.user.findUnique({
      where: { email: data.email },
    });

    // Même si l'utilisateur n'existe pas, on exécute quand même un bcrypt.compare
    // avec un hash factice pour éviter un timing attack (la réponse serait trop
    // rapide pour un email inconnu, révélant son existence).
    const passwordToCompare = user?.password ?? '$2b$12$invalidhashfortimingprotection000000000000000000000000000';

    const isPasswordValid = await bcrypt.compare(
      data.password,
      passwordToCompare,
    );

    if (!user || !isPasswordValid) {
      logger.warn(`[Auth] Tentative de connexion échouée pour : ${data.email}`);
      throw new AppError(401, GENERIC_ERROR);
    }

    logger.info(`[Auth] Connexion réussie : ${user.email} (id: ${user.id})`);

    const tokens = this.generateTokens(user);

    return { user: toAuthUser(user), tokens };
  }

  /**
   * Génère une paire access/refresh tokens pour un utilisateur.
   *
   * - Access token  : 15 minutes  (utilisé pour les requêtes API)
   * - Refresh token : 30 jours    (utilisé pour renouveler l'access token)
   */
  generateTokens(user: User): AuthTokens {
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
    };

    const ACCESS_EXPIRES_IN_SECONDS = 15 * 60; // 15 minutes
    const REFRESH_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60; // 30 jours

    const accessToken = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: ACCESS_EXPIRES_IN_SECONDS,
      issuer: 'colocos-api',
      audience: 'colocos-app',
    });

    // Le refresh token contient uniquement l'userId (surface d'attaque minimale)
    const refreshToken = jwt.sign(
      { userId: user.id },
      env.JWT_REFRESH_SECRET,
      {
        expiresIn: REFRESH_EXPIRES_IN_SECONDS,
        issuer: 'colocos-api',
        audience: 'colocos-app',
      },
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_EXPIRES_IN_SECONDS,
    };
  }

  /**
   * Renouvelle l'access token à partir d'un refresh token valide.
   *
   * @throws AppError(401) si le refresh token est invalide ou expiré
   */
  async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
    let decoded: { userId: string };

    try {
      decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, {
        issuer: 'colocos-api',
        audience: 'colocos-app',
      }) as { userId: string };
    } catch {
      throw new AppError(401, 'Refresh token invalide ou expiré. Veuillez vous reconnecter.');
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      throw new AppError(401, 'Utilisateur introuvable.');
    }

    logger.debug(`[Auth] Access token renouvelé pour : ${user.email}`);

    return this.generateTokens(user);
  }

  /**
   * Récupère le profil complet d'un utilisateur (sans le mot de passe).
   *
   * @throws AppError(404) si l'utilisateur est introuvable
   */
  async getProfile(userId: string): Promise<AuthUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError(404, 'Utilisateur introuvable.');
    }

    return toAuthUser(user);
  }

  /**
   * Met à jour le profil d'un utilisateur connecté.
   * Si un nouveau mot de passe est fourni, vérifie l'ancien avant de le changer.
   */
  async updateProfile(
    userId: string,
    data: UpdateProfileDTO,
  ): Promise<AuthUser> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, 'Utilisateur introuvable.');

    // ── Changement de mot de passe ────────────────────────────────────────────
    let newHashedPassword: string | undefined;

    if (data.newPassword && data.currentPassword) {
      const isCurrentValid = await bcrypt.compare(
        data.currentPassword,
        user.password,
      );

      if (!isCurrentValid) {
        throw new AppError(400, 'Le mot de passe actuel est incorrect.');
      }

      newHashedPassword = await bcrypt.hash(data.newPassword, BCRYPT_ROUNDS);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.colorHex && { colorHex: data.colorHex }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
        ...(newHashedPassword && { password: newHashedPassword }),
      },
    });

    logger.info(`[Auth] Profil mis à jour : ${updated.email}`);

    return toAuthUser(updated);
  }

  /**
   * Liste tous les colocataires (utile pour le module Finance et l'UI).
   * Ne retourne jamais les mots de passe.
   */
  async listRoommates(): Promise<AuthUser[]> {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
    });

    return users.map(toAuthUser);
  }
}

export const authService = new AuthService();
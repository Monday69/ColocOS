import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { InviteRequestStatus, User } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';
import { RegisterDTO, LoginDTO, UpdateProfileDTO } from '../dtos/auth.dto';
import { AuthUser, JwtPayload } from '../types';
import { safeEqual } from '../utils/safeCompare';

const IS_PRODUCTION = env.NODE_ENV === 'production';

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

/** Profil affiché dans le sélecteur « Qui cuisine aujourd'hui ? ». */
export interface ProfileSummary {
  id: string;
  name: string;
  colorHex: string;
  avatarUrl: string | null;
  hasPin: boolean;
  /** Mode de connexion exigé (AUTO_DEVICE | PIN_ONLY | USERNAME_PIN) */
  authMode: string;
  /** Identifiant de connexion (non secret) quand le mode l'exige */
  username: string | null;
}

export interface PinSession {
  user: AuthUser;
  tokens: AuthTokens;
}

const PIN_REGEX = /^\d{4}$/;
/** Session PIN : longue durée, la tablette de cuisine reste connectée. */
const PIN_SESSION_SECONDS = 30 * 24 * 60 * 60; // 30 jours
const PIN_REFRESH_SECONDS = 90 * 24 * 60 * 60; // 90 jours

// ── Helpers privés ────────────────────────────────────────────────────────────

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    colorHex: user.colorHex,
    username: user.username,
    authMode: user.authMode,
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
    // ── Code d'invitation ─────────────────────────────────────────────────────
    // Deux voies :
    //   1. le code maître `INVITE_CODE` (démo, partage manuel)
    //   2. une InviteRequest APPROVED, non expirée, portant ce code ET cette
    //      adresse email — sans elle, un code fuité servirait pour n'importe qui
    const submittedCode = (data.inviteCode ?? '').trim();
    const masterAccepted =
      Boolean(env.INVITE_CODE) &&
      submittedCode.length > 0 &&
      safeEqual(submittedCode, env.INVITE_CODE as string);

    const invitation = !masterAccepted && submittedCode
      ? await prisma.inviteRequest.findFirst({
          where: {
            code: submittedCode,
            email: data.email.trim().toLowerCase(),
            status: InviteRequestStatus.APPROVED,
            expiresAt: { gt: new Date() },
          },
        })
      : null;

    // Sans `INVITE_CODE` configuré, le mode démo laisse l'inscription ouverte.
    if (env.INVITE_CODE && !masterAccepted && !invitation) {
      throw new AppError(403, "Code d'invitation invalide ou expiré.");
    }

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

    // ── Création utilisateur (+ consommation du code d'invitation) ────────────
    // Le passage à USED est atomique avec la création du compte : pas de code
    // réutilisable si l'écriture échoue en cours de route.
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: data.name,
          email: data.email,
          password: hashedPassword,
          colorHex: data.colorHex,
          avatarUrl: data.avatarUrl ?? null,
          // Sur un serveur exposé, aucun profil ne s'ouvre sans code
          authMode: IS_PRODUCTION ? 'PIN_ONLY' : 'AUTO_DEVICE',
        },
      });

      if (invitation) {
        await tx.inviteRequest.update({
          where: { id: invitation.id },
          data: { status: InviteRequestStatus.USED },
        });
      }

      return created;
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

    // Identifiant unique : on vérifie avant d'écrire pour renvoyer un 409 clair
    let nextUsername: string | null | undefined;
    if (data.username !== undefined) {
      const normalized = data.username === null ? null : data.username.trim().toLowerCase();
      if (normalized) {
        const clash = await prisma.user.findUnique({
          where: { username: normalized },
          select: { id: true },
        });
        if (clash && clash.id !== userId) {
          throw new AppError(409, 'Cet identifiant est déjà utilisé.');
        }
      }
      nextUsername = normalized;
    }

    // Connexion sans code interdite sur un serveur exposé
    if (IS_PRODUCTION && data.authMode === 'AUTO_DEVICE') {
      throw new AppError(400, 'La connexion sans code est désactivée sur ce serveur.');
    }

    // `USERNAME_PIN` exige un identifiant : on refuse un mode incohérent
    if (data.authMode === 'USERNAME_PIN') {
      const candidate = nextUsername ?? user.username;
      if (!candidate) {
        throw new AppError(400, "Choisis un identifiant avant d'activer le mode identifiant + PIN.");
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.colorHex && { colorHex: data.colorHex }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
        ...(nextUsername !== undefined && { username: nextUsername }),
        ...(data.authMode && { authMode: data.authMode }),
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

  // ── Sélecteur de profils & code PIN ────────────────────────────────────────

  /**
   * Liste allégée pour l'écran « Qui cuisine aujourd'hui ? ».
   * Route publique : aucun email, aucun hash, seulement `hasPin`.
   */
  async listProfiles(): Promise<ProfileSummary[]> {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        colorHex: true,
        avatarUrl: true,
        pinHash: true,
        authMode: true,
        username: true,
      },
    });

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      colorHex: user.colorHex,
      avatarUrl: user.avatarUrl,
      hasPin: Boolean(user.pinHash),
      // En production, un ancien profil encore en AUTO_DEVICE est présenté
      // comme PIN_ONLY : le front ne propose jamais l'entrée sans code
      authMode: IS_PRODUCTION && user.authMode === 'AUTO_DEVICE' ? 'PIN_ONLY' : user.authMode,
      // L'identifiant n'est pas un secret : il sert au formulaire « identifiant + PIN »
      username: user.username,
    }));
  }

  /**
   * Connexion « appareil de confiance » : réservée aux profils `AUTO_DEVICE`.
   * Sur la tablette de cuisine, sélectionner le profil ouvre la session.
   */
  async loginWithDevice(userId: string): Promise<PinSession> {
    // Désactivé en production, même si la base contient encore AUTO_DEVICE
    if (IS_PRODUCTION) {
      throw new AppError(403, 'La connexion sans code est désactivée sur ce serveur.');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) throw new AppError(404, 'Profil introuvable.');
    if (user.authMode !== 'AUTO_DEVICE') {
      throw new AppError(403, 'Ce profil exige un code PIN pour se connecter.');
    }

    logger.info(`[Auth] Connexion appareil : ${user.name} (id: ${user.id})`);
    return { user: toAuthUser(user), tokens: this.generatePinTokens(user) };
  }

  /**
   * Lien magique NFC : régénère le jeton du badge et renvoie l'URL à écrire
   * dans un raccourci iOS. L'ancien jeton est immédiatement invalidé.
   */
  async regenerateNfcToken(userId: string): Promise<{ token: string }> {
    const token = randomUUID();

    await prisma.user.update({ where: { id: userId }, data: { nfcToken: token } });

    logger.info(`[Auth] Badge NFC régénéré pour ${userId}`);

    // L'URL publique dépend de la requête (tunnel, LAN, VPS) : c'est le
    // contrôleur qui la compose via `resolvePublicOrigin`.
    return { token };
  }

  /** Ouvre une session à partir du jeton NFC (lien magique). */
  async loginWithNfcToken(token: string): Promise<PinSession> {
    if (!token || token.length < 8) {
      throw new AppError(400, 'Jeton NFC invalide.');
    }

    const user = await prisma.user.findUnique({ where: { nfcToken: token } });
    if (!user) throw new AppError(401, 'Badge NFC inconnu ou révoqué.');

    logger.info(`[Auth] Connexion NFC : ${user.name} (id: ${user.id})`);
    return { user: toAuthUser(user), tokens: this.generatePinTokens(user) };
  }

  /**
   * Jeton de session longue durée (30 j) : la tablette de cuisine ne redemande
   * pas le PIN à chaque réveil. Même issuer/audience que l'access token pour
   * rester accepté par `authenticate`.
   */
  private generatePinTokens(user: User): AuthTokens {
    const payload: JwtPayload = { userId: user.id, email: user.email };

    const accessToken = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: PIN_SESSION_SECONDS,
      issuer: 'colocos-api',
      audience: 'colocos-app',
    });

    const refreshToken = jwt.sign({ userId: user.id }, env.JWT_REFRESH_SECRET, {
      expiresIn: PIN_REFRESH_SECONDS,
      issuer: 'colocos-api',
      audience: 'colocos-app',
    });

    return { accessToken, refreshToken, expiresIn: PIN_SESSION_SECONDS };
  }

  /**
   * Connexion par code PIN.
   *
   * SÉCURITÉ : message unique « Code PIN incorrect » (pas de distinction entre
   * profil inconnu / sans PIN / mauvais code) et `bcrypt.compare` exécuté même
   * sans PIN pour ne pas révéler l'absence de code par le temps de réponse.
   */
  async loginWithPin(userId: string, pin: string, username?: string): Promise<PinSession> {
    if (!PIN_REGEX.test(pin)) {
      throw new AppError(400, 'Le code PIN doit contenir exactement 4 chiffres.');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    const pinToCompare = user?.pinHash ?? '$2b$12$invalidhashfortimingprotection000000000000000000000000000';
    const isPinValid = await bcrypt.compare(pin, pinToCompare);

    // `USERNAME_PIN` : l'identifiant fait partie du secret exigé
    if (user?.authMode === 'USERNAME_PIN') {
      const expected = (user.username ?? '').toLowerCase();
      const provided = (username ?? '').trim().toLowerCase();
      if (!expected || provided !== expected) {
        logger.warn(`[Auth] Identifiant refusé pour le profil ${userId}`);
        throw new AppError(401, 'Identifiant ou code PIN incorrect.');
      }
    }

    if (!user || !user.pinHash || !isPinValid) {
      logger.warn(`[Auth] PIN refusé pour le profil ${userId}`);
      throw new AppError(401, 'Code PIN incorrect.');
    }

    logger.info(`[Auth] Connexion PIN : ${user.name} (id: ${user.id})`);

    return { user: toAuthUser(user), tokens: this.generatePinTokens(user) };
  }

  /**
   * Premier accès d'un profil : définit le code PIN (et l'email s'il manque),
   * puis connecte immédiatement.
   */
  async setupPin(
    userId: string,
    pin: string,
    email?: string,
    proof: { sessionUserId?: string; password?: string } = {},
  ): Promise<PinSession> {
    if (!PIN_REGEX.test(pin)) {
      throw new AppError(400, 'Le code PIN doit contenir exactement 4 chiffres.');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, 'Profil introuvable.');

    if (user.pinHash) {
      throw new AppError(409, 'Ce profil a déjà un code PIN. Connecte-toi avec ce code.');
    }

    // En production, poser le premier PIN exige de prouver qu'on est le
    // titulaire : soit une session ouverte sur ce compte, soit son mot de passe.
    if (IS_PRODUCTION && proof.sessionUserId !== user.id) {
      // Compte sans hash exploitable (créé hors inscription) : on ne compare
      // rien et on renvoie vers l'administrateur plutôt que d'échouer en 500
      const storedHash = user.password ?? '';
      if (!storedHash.startsWith('$2')) {
        throw new AppError(
          403,
          "Aucun mot de passe défini sur ce compte : contacte l'administrateur de la coloc.",
        );
      }
      const passwordOk = proof.password
        ? await bcrypt.compare(proof.password, storedHash)
        : false;
      if (!passwordOk) {
        throw new AppError(401, 'Mot de passe du compte requis pour créer ton code PIN.');
      }
    }

    let nextEmail = user.email;
    if (email) {
      const normalized = email.trim().toLowerCase();
      if (normalized !== user.email.toLowerCase()) {
        const exists = await prisma.user.findUnique({
          where: { email: normalized },
          select: { id: true },
        });
        if (exists && exists.id !== user.id) {
          throw new AppError(409, 'Cette adresse email est déjà utilisée par un autre profil.');
        }
        nextEmail = normalized;
      }
    }

    const pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        pinHash,
        ...(nextEmail !== user.email ? { email: nextEmail } : {}),
      },
    });

    await prisma.activityLog.create({
      data: {
        action: 'USER_JOINED',
        userId: updated.id,
        meta: { event: 'pin_setup', emailChanged: nextEmail !== user.email },
      },
    });

    logger.info(`[Auth] PIN initialisé pour ${updated.name} (id: ${updated.id})`);

    return { user: toAuthUser(updated), tokens: this.generatePinTokens(updated) };
  }

  /** Définit / change le PIN depuis une session déjà authentifiée. */
  async updatePin(userId: string, currentPin: string | null, pin: string): Promise<void> {
    if (!PIN_REGEX.test(pin)) {
      throw new AppError(400, 'Le code PIN doit contenir exactement 4 chiffres.');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, 'Profil introuvable.');

    if (user.pinHash) {
      if (!currentPin) throw new AppError(400, 'Le code PIN actuel est requis.');
      const valid = await bcrypt.compare(currentPin, user.pinHash);
      if (!valid) throw new AppError(401, 'Code PIN actuel incorrect.');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { pinHash: await bcrypt.hash(pin, BCRYPT_ROUNDS) },
    });

    logger.info(`[Auth] PIN mis à jour pour ${user.name}`);
  }
}

export const authService = new AuthService();
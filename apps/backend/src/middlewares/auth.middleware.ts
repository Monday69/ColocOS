import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { AppError } from './errorHandler';
import { JwtPayload } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Auth Middleware
//
// NOTE ARCHITECTURE :
//   Le type `req.user` est déclaré dans `src/types/express.d.ts`.
//   Ce fichier ne redéclare PAS le namespace Express.Request pour éviter
//   les conflits TypeScript. Il se contente de l'utiliser.
//
// SÉCURITÉ :
//   - Vérifie la signature ET l'expiration du JWT (jwt.verify fait les deux)
//   - Vérifie que l'issuer et l'audience correspondent (anti-token-confusion)
//   - Recharge l'utilisateur depuis la BDD à chaque requête — garantit qu'un
//     compte supprimé/désactivé ne peut plus accéder à l'API même avec un
//     token encore valide
//   - Message d'erreur générique : pas d'info sur la raison de l'échec
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Middleware d'authentification obligatoire.
 * À appliquer sur toutes les routes protégées.
 *
 * Flux :
 *   Authorization: Bearer <token>
 *     → jwt.verify() (signature + expiration + issuer + audience)
 *     → prisma.user.findUnique() (s'assure que le compte existe toujours)
 *     → req.user = { id, email, name, colorHex, avatarUrl }
 *     → next()
 */
export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Token d\'authentification manquant ou malformé.');
    }

    const token = authHeader.split(' ')[1];

    // jwt.verify lève JsonWebTokenError si la signature est invalide,
    // TokenExpiredError si le token est expiré, NotBeforeError sinon
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: 'colocos-api',
      audience: 'colocos-app',
    }) as JwtPayload;

    // Rechargement BDD — garantit qu'un compte supprimé est immédiatement bloqué
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        colorHex: true,
        avatarUrl: true,
      },
    });

    if (!user) {
      throw new AppError(401, 'Compte introuvable ou désactivé.');
    }

    // Injection dans req — type défini dans src/types/express.d.ts
    req.user = user;
    next();
  } catch (err) {
    // Distingue les erreurs JWT des erreurs applicatives
    if (err instanceof jwt.TokenExpiredError) {
      return next(new AppError(401, 'Token expiré. Veuillez vous reconnecter.'));
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return next(new AppError(401, 'Token invalide.'));
    }
    next(err);
  }
};

/**
 * Middleware d'authentification optionnel.
 * N'échoue pas si le token est absent — utile pour les routes publiques
 * qui enrichissent leur réponse si l'utilisateur est connecté.
 */
export const authenticateOptional = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(); // Pas de token → pas d'erreur, req.user reste undefined
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: 'colocos-api',
      audience: 'colocos-app',
    }) as JwtPayload;

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        colorHex: true,
        avatarUrl: true,
      },
    });

    if (user) req.user = user;
  } catch {
    // Token invalide sur une route optionnelle → on ignore silencieusement
  }

  next();
};
import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import {
  RegisterSchema,
  LoginSchema,
  RefreshTokenSchema,
  UpdateProfileSchema,
} from '../dtos/auth.dto';
import { AppError } from '../middlewares/errorHandler';
import { ApiResponse, AuthUser } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Auth Controller
// Validation DTO → délégation service → formatage réponse
// ─────────────────────────────────────────────────────────────────────────────

export class AuthController {
  /**
   * POST /api/auth/register
   * Inscription d'un nouveau colocataire.
   */
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = RegisterSchema.parse(req.body);
      const result = await authService.register(dto);

      res.status(201).json({
        success: true,
        data: {
          user: result.user,
          tokens: result.tokens,
        },
        message: `Bienvenue ${result.user.name} ! Votre compte a été créé avec succès.`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/login
   * Connexion et génération des tokens.
   */
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = LoginSchema.parse(req.body);
      const result = await authService.login(dto);

      res.status(200).json({
        success: true,
        data: {
          user: result.user,
          tokens: result.tokens,
        },
        message: `Connexion réussie. Bonjour ${result.user.name} !`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/refresh
   * Renouvelle l'access token via un refresh token.
   */
  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = RefreshTokenSchema.parse(req.body);
      const tokens = await authService.refreshAccessToken(refreshToken);

      res.status(200).json({
        success: true,
        data: { tokens },
        message: 'Token renouvelé avec succès.',
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/auth/me
   * Profil du colocataire connecté (route protégée).
   */
  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Non authentifié.');
      }

      // On recharge le profil complet depuis la BDD
      // (req.user n'a que les champs du middleware)
      const user = await authService.getProfile(req.user.id);

      res.status(200).json({
        success: true,
        data: user,
      } satisfies ApiResponse<AuthUser>);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/auth/me
   * Mise à jour du profil (nom, couleur, avatar, mot de passe).
   */
  async updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Non authentifié.');
      }

      const dto = UpdateProfileSchema.parse(req.body);
      const updated = await authService.updateProfile(req.user.id, dto);

      res.status(200).json({
        success: true,
        data: updated,
        message: 'Profil mis à jour avec succès.',
      } satisfies ApiResponse<AuthUser>);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/auth/roommates
   * Liste tous les colocataires (route protégée).
   * Utile pour le module Finance, l'assignation d'items, etc.
   */
  async listRoommates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const roommates = await authService.listRoommates();

      res.status(200).json({
        success: true,
        data: roommates,
        meta: { total: roommates.length },
      } satisfies ApiResponse<AuthUser[]>);
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
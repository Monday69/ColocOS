import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import {
  RegisterSchema,
  RequestInviteSchema,
  LoginSchema,
  RefreshTokenSchema,
  UpdateProfileSchema,
  LoginPinSchema,
  DeviceLoginSchema,
  SetupPinSchema,
  UpdatePinSchema,
} from '../dtos/auth.dto';
import { buildNfcUrl } from '../utils/publicOrigin';
import { inviteService } from '../services/invite.service';
import { renderApproveForm, renderApproveResult } from '../utils/invitePages';
import { AppError } from '../middlewares/errorHandler';
import { ApiResponse, AuthUser } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Auth Controller
// Validation DTO → délégation service → formatage réponse
// ─────────────────────────────────────────────────────────────────────────────

export class AuthController {
  /**
   * POST /api/auth/request-invite
   * Dépose une demande d'accès et notifie l'administrateur.
   *
   * Réponse volontairement identique que l'email corresponde ou non à un
   * compte existant : cet endpoint ne doit pas permettre d'énumérer les
   * adresses inscrites.
   */
  async requestInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = RequestInviteSchema.parse(req.body);

      // Champ piège rempli → robot : on répond « succès » sans rien créer.
      if (dto.website) {
        res.status(202).json({
          success: true,
          data: null,
          message: "Demande envoyée à l'administrateur.",
        } satisfies ApiResponse);
        return;
      }

      await inviteService.createRequest({ name: dto.name, email: dto.email }, req);

      res.status(202).json({
        success: true,
        data: null,
        message: "Demande envoyée à l'administrateur.",
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/auth/approve-invite?token=…
   * Affiche le formulaire de confirmation (n'approuve rien).
   */
  async approveInvitePage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      const request = await inviteService.findByToken(token);

      if (!request) {
        const { status, html } = renderApproveResult(false, '', 'INVALID');
        res.status(status).type('html').send(html);
        return;
      }

      if (request.status !== 'PENDING' || request.expiresAt.getTime() < Date.now()) {
        const reason = request.status === 'PENDING' ? 'EXPIRED' : request.status;
        const { status, html } = renderApproveResult(false, request.email, reason);
        res.status(status).type('html').send(html);
        return;
      }

      const { html } = renderApproveForm({
        token,
        name: request.name,
        email: request.email,
        expiresAt: request.expiresAt,
      });
      res.status(200).type('html').send(html);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/approve-invite
   * Confirme l'approbation et envoie le code d'invitation au demandeur.
   */
  async approveInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const raw = (req.body as Record<string, unknown> | undefined)?.token;
      const token = typeof raw === 'string' ? raw : '';

      if (!token) {
        const { status, html } = renderApproveResult(false, '', 'MISSING_TOKEN');
        res.status(status).type('html').send(html);
        return;
      }

      const result = await inviteService.approve(token, req);
      const { status, html } = renderApproveResult(result.ok, result.ok ? result.email : '', result.ok ? undefined : result.reason);
      res.status(status).type('html').send(html);
    } catch (err) {
      next(err);
    }
  }

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
   * GET /api/auth/profiles
   * Sélecteur « Qui cuisine aujourd'hui ? » (public, aucune donnée sensible).
   */
  async profiles(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const profiles = await authService.listProfiles();

      res.status(200).json({
        success: true,
        data: profiles,
        meta: { total: profiles.length },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/login-pin
   * Connexion par code PIN à 4 chiffres (public, rate-limited).
   */
  async loginPin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = LoginPinSchema.parse(req.body);
      const result = await authService.loginWithPin(dto.userId, dto.pin, dto.username);

      res.status(200).json({
        success: true,
        data: { user: result.user, tokens: result.tokens },
        message: `Bonjour ${result.user.name} !`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/device
   * Sélection de profil sans PIN (`AUTO_DEVICE`) : tablette de cuisine.
   */
  async deviceLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = DeviceLoginSchema.parse(req.body);
      const result = await authService.loginWithDevice(dto.userId);

      res.status(200).json({
        success: true,
        data: { user: result.user, tokens: result.tokens },
        message: `Bonjour ${result.user.name} !`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/nfc/regenerate
   * Régénère le jeton du badge NFC de l'utilisateur courant.
   */
  async regenerateNfc(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');
      const { token } = await authService.regenerateNfcToken(req.user.id);

      // URL prête à écrire sur le badge : origine réellement utilisée par le
      // client (trycloudflare.com, 192.168.x.x, domaine du VPS…), jamais
      // `localhost` quand la requête passe par un proxy.
      res.status(200).json({
        success: true,
        data: { token, url: buildNfcUrl(req, token) },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/auth/nfc?token=<uuid>
   * Lien magique : ouvre la session puis redirige vers l'app.
   * Le jeton de session voyage dans le fragment (`#nfc=`), jamais dans la
   * query string : il n'apparaît donc ni dans les logs serveur ni dans les
   * en-têtes Referer.
   */
  async nfcLogin(req: Request, res: Response): Promise<void> {
    try {
      const token = String(req.query.token ?? '');
      const result = await authService.loginWithNfcToken(token);

      // Redirection RELATIVE : le navigateur reste sur le domaine courant
      // (tunnel, LAN, VPS) au lieu d'être renvoyé vers `localhost`.
      res.redirect(302, `/#nfc=${encodeURIComponent(result.tokens.accessToken)}`);
    } catch {
      res.redirect(302, '/#nfc-error=1');
    }
  }

  /**
   * POST /api/auth/setup-pin
   * Premier accès : définit le PIN (et l'email si fourni), connecte aussitôt.
   */
  async setupPin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = SetupPinSchema.parse(req.body);
      const result = await authService.setupPin(dto.userId, dto.pin, dto.email);

      res.status(201).json({
        success: true,
        data: { user: result.user, tokens: result.tokens },
        message: `Code PIN enregistré. Bienvenue ${result.user.name} !`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/me/pin
   * Change le code PIN depuis une session authentifiée.
   */
  async updatePin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');

      const dto = UpdatePinSchema.parse(req.body);
      await authService.updatePin(req.user.id, dto.currentPin ?? null, dto.pin);

      res.status(200).json({
        success: true,
        data: { updated: true },
        message: 'Code PIN mis à jour.',
      } satisfies ApiResponse);
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
import { randomBytes } from 'crypto';
import { InviteRequestStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';
import { sendInviteApprovalRequest, sendInviteCodeToUser } from './mail.service';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Inscription sur demande
//
// Cycle de vie d'une InviteRequest :
//   PENDING  → déposée depuis l'écran de connexion, l'admin reçoit un email
//   APPROVED → l'admin a cliqué sur le lien (POST, donc pas de préchargement)
//   USED     → le code a servi à créer un compte
//   EXPIRED  → 48 h écoulées sans approbation (ou approbation trop tardive)
// ─────────────────────────────────────────────────────────────────────────────

/** Durée de vie d'une demande. */
const INVITE_TTL_HOURS = 48;

/** Alphabet sans caractères ambigus (pas de 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length = 4): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `COLOC-${out}`;
}

/** Code unique : régénère en cas de collision (probabilité très faible). */
async function generateUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    const taken = await prisma.inviteRequest.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!taken) return code;
  }
  throw new AppError(500, "Impossible de générer un code d'invitation.");
}

function addHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/** Site public vu par le navigateur de l'admin (jamais `localhost` en proxy). */
function publicBaseUrl(req: { protocol: string; header: (name: string) => string | undefined }): string {
  const forwardedProto = req.header('x-forwarded-proto')?.split(',')[0].trim();
  const forwardedHost = req.header('x-forwarded-host')?.split(',')[0].trim();
  const host = forwardedHost || req.header('host');

  if (host) {
    return `${forwardedProto || req.protocol || 'http'}://${host}`;
  }
  return env.FRONTEND_URL.replace(/\/$/, '');
}

export interface CreateInviteRequestInput {
  name: string;
  email: string;
}

export interface CreateInviteRequestResult {
  created: boolean;
  reason?: 'ACCOUNT_EXISTS' | 'PENDING_RECENT';
}

export class InviteService {
  /**
   * Dépose une demande d'accès.
   *
   * Le résultat ne distingue pas « compte existant » de « demande en cours »
   * côté HTTP (voir contrôleur) afin de ne pas transformer cet endpoint en
   * oracle d'existence de comptes.
   */
  async createRequest(
    input: CreateInviteRequestInput,
    req: { protocol: string; header: (name: string) => string | undefined },
  ): Promise<CreateInviteRequestResult> {
    const email = input.email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      logger.info(`[Invite] Demande ignorée (compte existant) : ${email}`);
      return { created: false, reason: 'ACCOUNT_EXISTS' };
    }

    // Une demande PENDING de moins de 6 h est considérée comme « récente » :
    // on ne renvoie pas d'email pour éviter le spam de l'administrateur.
    const recent = await prisma.inviteRequest.findFirst({
      where: {
        email,
        status: InviteRequestStatus.PENDING,
        createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (recent) {
      logger.info(`[Invite] Demande déjà en cours : ${email}`);
      return { created: false, reason: 'PENDING_RECENT' };
    }

    // Les anciennes demandes PENDING du même email sont expirées d'office :
    // un seul jeton actif à la fois.
    await prisma.inviteRequest.updateMany({
      where: { email, status: InviteRequestStatus.PENDING },
      data: { status: InviteRequestStatus.EXPIRED },
    });

    const request = await prisma.inviteRequest.create({
      data: {
        name: input.name.trim(),
        email,
        code: await generateUniqueCode(),
        approvalToken: randomBytes(32).toString('hex'),
        expiresAt: addHours(INVITE_TTL_HOURS),
      },
    });

    const approvalUrl = `${publicBaseUrl(req)}/api/auth/approve-invite?token=${request.approvalToken}`;

    // Non bloquant : un échec d'email ne doit pas faire échouer la demande.
    await sendInviteApprovalRequest({ name: request.name, email: request.email, approvalUrl });

    logger.info(`[Invite] Demande créée pour ${email} (expire le ${request.expiresAt.toISOString()})`);
    return { created: true };
  }

  /** Demande associée à un jeton d'approbation, quel que soit son statut. */
  async findByToken(token: string) {
    if (!token || token.length !== 64 || !/^[a-f0-9]+$/i.test(token)) {
      return null;
    }
    return prisma.inviteRequest.findUnique({ where: { approvalToken: token } });
  }

  /**
   * Approuve une demande : PENDING + non expirée → APPROVED, puis envoi du
   * code au demandeur.
   */
  async approve(
    token: string,
    req: { protocol: string; header: (name: string) => string | undefined },
  ): Promise<{ ok: true; name: string; email: string } | { ok: false; reason: string }> {
    const request = await this.findByToken(token);
    if (!request) return { ok: false, reason: 'INVALID' };

    if (request.status === InviteRequestStatus.USED) return { ok: false, reason: 'USED' };
    if (request.status === InviteRequestStatus.APPROVED) return { ok: false, reason: 'ALREADY_APPROVED' };
    if (request.status === InviteRequestStatus.EXPIRED) return { ok: false, reason: 'EXPIRED' };
    if (request.expiresAt.getTime() < Date.now()) {
      await prisma.inviteRequest.update({
        where: { id: request.id },
        data: { status: InviteRequestStatus.EXPIRED },
      });
      return { ok: false, reason: 'EXPIRED' };
    }

    await prisma.inviteRequest.update({
      where: { id: request.id },
      data: { status: InviteRequestStatus.APPROVED, approvedAt: new Date() },
    });

    const registerUrl = `${publicBaseUrl(req)}/?invite=${encodeURIComponent(request.code)}&email=${encodeURIComponent(request.email)}`;
    await sendInviteCodeToUser({
      name: request.name,
      email: request.email,
      code: request.code,
      registerUrl,
    });

    logger.info(`[Invite] Demande approuvée pour ${request.email}`);
    return { ok: true, name: request.name, email: request.email };
  }
}

export const inviteService = new InviteService();

import { createHash, randomBytes, randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { AppError } from '../middlewares/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Appareils de confiance
//
// Un navigateur devient « de confiance » pour un compte après une connexion
// forte (email + mot de passe, inscription, ou création du premier PIN avec
// mot de passe). Il reçoit alors un cookie `HttpOnly` :
//
//   colocos_device = <deviceId>.<secret>
//
// - `deviceId` identifie le navigateur ; plusieurs comptes peuvent y être liés
//   (tablette de cuisine partagée) → une ligne par paire (deviceId, userId).
// - `secret` (32 octets aléatoires) n'est jamais stocké : seule son empreinte
//   SHA-256 est en base, comme un mot de passe.
//
// En production, le sélecteur de profils et la connexion par PIN ne
// fonctionnent que depuis un appareil de confiance pour ce compte : le PIN
// devient un second facteur (ce que tu possèdes + ce que tu sais).
// ─────────────────────────────────────────────────────────────────────────────

export const DEVICE_COOKIE = 'colocos_device';
const COOKIE_PATH = '/api/auth';
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000; // 180 jours, prolongé à chaque connexion

interface DeviceCredential {
  deviceId: string;
  secret: string;
}

export interface TrustedDeviceSummary {
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date;
  isCurrent: boolean;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function readCredential(req: Request): DeviceCredential | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== DEVICE_COOKIE) continue;

    let value: string;
    try {
      value = decodeURIComponent(rest.join('='));
    } catch {
      return null;
    }
    const [deviceId, secret] = value.split('.');
    const valid =
      /^[0-9a-f-]{36}$/.test(deviceId ?? '') && /^[A-Za-z0-9_-]{43}$/.test(secret ?? '');
    return valid ? { deviceId, secret } : null;
  }
  return null;
}

function writeCookie(res: Response, credential: DeviceCredential): void {
  res.cookie(DEVICE_COOKIE, `${credential.deviceId}.${credential.secret}`, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: MAX_AGE_MS,
  });
}

/** Libellé lisible pour l'écran « Appareils enregistrés » (pas d'empreinte fine). */
function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Appareil';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'navigateur';
  return `${os} · ${browser}`;
}

class TrustedDeviceService {
  /** La confiance par appareil n'est exigée qu'en production (la démo locale reste ouverte). */
  get enforced(): boolean {
    return env.NODE_ENV === 'production';
  }

  /**
   * Enregistre (ou rafraîchit) ce navigateur pour `userId`, puis pose le cookie.
   * À n'appeler qu'après une preuve forte d'identité.
   */
  async enroll(req: Request, res: Response, userId: string): Promise<void> {
    let credential = readCredential(req);

    if (credential) {
      // Un deviceId déjà connu avec un AUTRE secret : cookie forgé ou périmé,
      // on ne le réutilise pas (sinon on pourrait se greffer sur l'appareil d'un autre).
      const conflicting = await prisma.trustedDevice.count({
        where: { deviceId: credential.deviceId, NOT: { tokenHash: sha256(credential.secret) } },
      });
      if (conflicting > 0) credential = null;
    }

    if (!credential) {
      credential = { deviceId: randomUUID(), secret: randomBytes(32).toString('base64url') };
    }

    const tokenHash = sha256(credential.secret);
    await prisma.trustedDevice.upsert({
      where: { deviceId_userId: { deviceId: credential.deviceId, userId } },
      create: {
        deviceId: credential.deviceId,
        userId,
        tokenHash,
        label: deviceLabel(req.headers['user-agent']),
      },
      update: { tokenHash, lastUsedAt: new Date() },
    });

    writeCookie(res, credential);
  }

  /** Comptes enregistrés sur ce navigateur (cookie valide). */
  async trustedUserIds(req: Request): Promise<Set<string>> {
    const credential = readCredential(req);
    if (!credential) return new Set();

    const rows = await prisma.trustedDevice.findMany({
      where: { deviceId: credential.deviceId, tokenHash: sha256(credential.secret) },
      select: { userId: true },
    });
    return new Set(rows.map((row) => row.userId));
  }

  /**
   * Vérifie que ce navigateur est de confiance pour `userId` ; si oui, met à
   * jour `lastUsedAt` et prolonge le cookie.
   */
  async verify(req: Request, res: Response, userId: string): Promise<boolean> {
    const credential = readCredential(req);
    if (!credential) return false;

    const updated = await prisma.trustedDevice.updateMany({
      where: { deviceId: credential.deviceId, userId, tokenHash: sha256(credential.secret) },
      data: { lastUsedAt: new Date() },
    });
    if (updated.count === 0) return false;

    writeCookie(res, credential);
    return true;
  }

  async list(req: Request, userId: string): Promise<TrustedDeviceSummary[]> {
    const credential = readCredential(req);
    const rows = await prisma.trustedDevice.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      isCurrent: Boolean(
        credential &&
          row.deviceId === credential.deviceId &&
          row.tokenHash === sha256(credential.secret),
      ),
    }));
  }

  /** Révoque un appareil du compte courant (téléphone perdu, ancienne tablette…). */
  async revoke(userId: string, id: string): Promise<void> {
    const removed = await prisma.trustedDevice.deleteMany({ where: { id, userId } });
    if (removed.count === 0) throw new AppError(404, 'Appareil introuvable.');
  }
}

export const trustedDeviceService = new TrustedDeviceService();

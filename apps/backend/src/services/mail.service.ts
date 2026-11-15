import { env } from '../config/env';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Envoi d'emails transactionnels (Resend)
//
// Aucune dépendance npm : `fetch` natif de Node 22 vers l'API REST Resend.
// Sans `RESEND_API_KEY` (dev, démo, CI), rien n'est envoyé : le contenu utile
// (lien d'approbation, code d'invitation) est journalisé côté serveur pour
// permettre de tester le parcours de bout en bout.
// ─────────────────────────────────────────────────────────────────────────────

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

interface MailPayload {
  to: string;
  subject: string;
  html: string;
}

/** Échappement HTML minimal : les noms/emails viennent de l'utilisateur. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Gabarit commun : sobre, lisible sur mobile, sans ressource externe. */
function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:24px;background:#0b1220;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e2e8f0;">
    <div style="max-width:520px;margin:0 auto;background:#111a2e;border:1px solid #1e293b;border-radius:16px;padding:24px;">
      <p style="margin:0 0 16px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#38bdf8;">ColocOS</p>
      ${body}
      <p style="margin:24px 0 0;font-size:11px;color:#64748b;">
        Email automatique — merci de ne pas y répondre.
      </p>
    </div>
  </body>
</html>`;
}

async function sendMail({ to, subject, html }: MailPayload): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    logger.warn('[Mail] RESEND_API_KEY absente — email non envoyé (mode démo).');
    return false;
  }
  if (!to) {
    logger.warn('[Mail] Destinataire manquant — email ignoré.');
    return false;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.error(`[Mail] Resend a répondu ${response.status} : ${detail.slice(0, 300)}`);
      return false;
    }

    logger.info(`[Mail] Email « ${subject} » envoyé à ${to.replace(/(.{2}).*(@.*)/, '$1***$2')}`);
    return true;
  } catch (error) {
    logger.error(`[Mail] Échec d'envoi : ${String(error)}`);
    return false;
  }
}

export interface InviteApprovalParams {
  name: string;
  email: string;
  approvalUrl: string;
}

/** Notifie l'administrateur qu'une demande d'accès attend son approbation. */
export async function sendInviteApprovalRequest({
  name,
  email,
  approvalUrl,
}: InviteApprovalParams): Promise<boolean> {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeUrl = escapeHtml(approvalUrl);

  // Sans clé API, on journalise le lien pour permettre la validation manuelle.
  if (!env.RESEND_API_KEY) {
    logger.info(`[Mail] (démo) Demande de ${name} <${email}> — approbation : ${approvalUrl}`);
  }

  if (!env.ADMIN_EMAIL) {
    logger.warn('[Mail] ADMIN_EMAIL absente — impossible de notifier un administrateur.');
    if (!env.RESEND_API_KEY) return false;
  }

  const html = layout(
    "Nouvelle demande d'accès",
    `<h1 style="margin:0 0 12px;font-size:20px;">Nouvelle demande d'accès</h1>
     <p style="margin:0 0 8px;font-size:14px;color:#cbd5e1;">
       <strong>${safeName}</strong> souhaite rejoindre la coloc.
     </p>
     <p style="margin:0 0 20px;font-size:14px;color:#94a3b8;">${safeEmail}</p>
     <a href="${safeUrl}" style="display:inline-block;background:#38bdf8;color:#04121f;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px;font-size:14px;">
       Examiner la demande
     </a>
     <p style="margin:20px 0 0;font-size:11px;color:#64748b;">
       Le lien expire dans 48 heures et demande une confirmation pour éviter
       qu'un filtre anti-spam ne l'active par simple préchargement.
     </p>`,
  );

  return sendMail({
    to: env.ADMIN_EMAIL ?? '',
    subject: `[ColocOS] Demande d'accès — ${name}`,
    html,
  });
}

export interface InviteCodeParams {
  name: string;
  email: string;
  code: string;
  registerUrl: string;
}

/** Transmet son code d'invitation au colocataire approuvé. */
export async function sendInviteCodeToUser({
  name,
  email,
  code,
  registerUrl,
}: InviteCodeParams): Promise<boolean> {
  const safeName = escapeHtml(name);
  const safeCode = escapeHtml(code);
  const safeUrl = escapeHtml(registerUrl);

  // Sans clé API, on journalise le code pour permettre l'inscription.
  if (!env.RESEND_API_KEY) {
    logger.info(`[Mail] (démo) Code d'invitation pour ${email} : ${code} — inscription : ${registerUrl}`);
  }

  const html = layout(
    'Votre accès ColocOS',
    `<h1 style="margin:0 0 12px;font-size:20px;">Bienvenue ${safeName} !</h1>
     <p style="margin:0 0 16px;font-size:14px;color:#cbd5e1;">
       Votre demande d'accès a été approuvée. Voici votre code personnel :
     </p>
     <p style="margin:0 0 20px;font-size:22px;letter-spacing:.14em;font-weight:700;color:#38bdf8;">${safeCode}</p>
     <a href="${safeUrl}" style="display:inline-block;background:#38bdf8;color:#04121f;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px;font-size:14px;">
       Créer mon compte
     </a>
     <p style="margin:20px 0 0;font-size:11px;color:#64748b;">
       Ce code est à usage unique et personnel. Le lien pré-remplit le formulaire
       avec votre adresse.
     </p>`,
  );

  return sendMail({
    to: email,
    subject: '[ColocOS] Votre code d’invitation',
    html,
  });
}

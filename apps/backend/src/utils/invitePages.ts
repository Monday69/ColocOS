// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Pages HTML du flux d'approbation
//
// Servies directement par l'API (aucun build frontend requis) : l'admin peut
// cliquer le lien depuis son téléphone. Le GET n'approuve RIEN — il affiche
// un formulaire POST, pour qu'un scanner anti-spam qui précharge les liens
// d'email ne valide pas la demande à la place de l'administrateur.
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title: string, body: string, status = 200): { status: number; html: string } {
  return {
    status,
    html: `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${escapeHtml(title)} — ColocOS</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
        padding: max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom));
        background: radial-gradient(120% 80% at 50% 0%, #12203a 0%, #060b14 60%);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: #e2e8f0;
      }
      main {
        width: 100%; max-width: 420px; padding: 28px 24px; border-radius: 22px;
        background: rgba(17, 26, 46, 0.86); border: 1px solid rgba(148, 163, 184, 0.18);
        box-shadow: 0 24px 60px -24px rgba(2, 6, 23, 0.9);
      }
      .eyebrow { margin: 0 0 18px; font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: #38bdf8; }
      h1 { margin: 0 0 10px; font-size: 21px; line-height: 1.25; }
      p { margin: 0 0 12px; font-size: 14px; line-height: 1.5; color: #b6c2d4; }
      strong { color: #f1f5f9; }
      .value { font-variant-numeric: tabular-nums; letter-spacing: .02em; }
      button {
        width: 100%; margin-top: 18px; padding: 15px 18px; border: 0; border-radius: 14px;
        background: #38bdf8; color: #04121f; font-size: 15px; font-weight: 700;
        letter-spacing: .01em; cursor: pointer; -webkit-tap-highlight-color: transparent;
      }
      button:active { transform: scale(.985); }
      .note { margin: 16px 0 0; font-size: 11px; color: #64748b; }
      .bad { color: #fca5a5; }
      .good { color: #86efac; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">ColocOS</p>
      ${body}
    </main>
  </body>
</html>`,
  };
}

/** Formulaire de confirmation (GET) — n'approuve rien par lui-même. */
export function renderApproveForm(params: {
  token: string;
  name: string;
  email: string;
  expiresAt: Date;
}): { status: number; html: string } {
  const expires = params.expiresAt.toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return page(
    "Demande d'accès",
    `<h1>Demande d'accès</h1>
     <p><strong>${escapeHtml(params.name)}</strong></p>
     <p class="value">${escapeHtml(params.email)}</p>
     <p class="note">Demande valable jusqu'au ${escapeHtml(expires)}.</p>
     <form method="POST" action="/api/auth/approve-invite">
       <input type="hidden" name="token" value="${escapeHtml(params.token)}" />
       <button type="submit">Confirmer et envoyer le code</button>
     </form>
     <p class="note">Un code d'invitation personnel sera envoyé à cette adresse.</p>`,
  );
}

/** Confirmation (POST) — page finale, ou erreur explicite. */
export function renderApproveResult(ok: boolean, email: string, reason?: string): { status: number; html: string } {
  if (ok) {
    return page(
      'Code envoyé',
      `<h1 class="good">Demande approuvée</h1>
       <p>Un code d'invitation vient d'être envoyé à <strong>${escapeHtml(email)}</strong>.</p>
       <p class="note">Le demandeur peut désormais créer son compte avec ce code.</p>`,
    );
  }

  const messages: Record<string, string> = {
    INVALID: "Ce lien d'approbation est invalide.",
    EXPIRED: 'Cette demande a expiré (48 h). Le demandeur doit en déposer une nouvelle.',
    USED: 'Ce code a déjà servi : la demande est close.',
    ALREADY_APPROVED: 'Cette demande a déjà été approuvée.',
    MISSING_TOKEN: "Jeton d'approbation manquant.",
  };

  return page(
    'Demande non aboutie',
    `<h1 class="bad">Demande non aboutie</h1>
     <p>${escapeHtml(messages[reason ?? 'INVALID'] ?? 'Opération impossible.')}</p>
     <p class="note">Aucune action n'est nécessaire de votre côté.</p>`,
    400,
  );
}

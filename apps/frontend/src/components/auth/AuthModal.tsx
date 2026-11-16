import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, KeyRound, Ticket, UserPlus } from 'lucide-react';
import { useAuth } from '@/store';
import { api } from '@/api/client';
import { ProfilePickerModal } from '@/components/auth/ProfilePickerModal';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — AuthModal
//
// Écran d'accueil : sélecteur de profils « Qui cuisine aujourd'hui ? » (code
// PIN 4 chiffres) avec repli sur la connexion email / mot de passe historique,
// plus deux accès discrets :
//   • « Demander un accès »     → POST /auth/request-invite (approbation admin)
//   • « J'ai un code d'invitation » → POST /auth/register
//
// Un lien reçu par email (`/?invite=COLOC-XXXX&email=…`) ouvre directement le
// formulaire d'inscription pré-rempli.
// ─────────────────────────────────────────────────────────────────────────────

type Mode = 'picker' | 'password' | 'request' | 'register';

const AVATAR_COLORS = ['#3B82F6', '#E08544', '#22D3EE', '#A855F7', '#34D399', '#F43F5E'];

const PASSWORD_RULES = [
  { label: '8 caractères minimum', test: (value: string) => value.length >= 8 },
  { label: '1 majuscule', test: (value: string) => /[A-ZÀ-Þ]/.test(value) },
  { label: '1 chiffre', test: (value: string) => /[0-9]/.test(value) },
  { label: '1 caractère spécial', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

/** Même règle que le serveur (utils/pinStrength.ts) : retour immédiat à l'écran. */
function isWeakPin(pin: string): boolean {
  if (!/^\d{4}$/.test(pin)) return true;
  const d = pin.split('').map(Number);
  if (d.every((x) => x === d[0])) return true;
  const steps = d.slice(1).map((x, i) => x - d[i]);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  return /^(19|20)\d\d$/.test(pin);
}

const fieldClass =
  'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 font-body text-sm text-white focus:outline-none focus:border-accent/60';

export const AuthModal = () => {
  // ✅ ON SÉPARE LES SÉLECTEURS POUR ÉVITER LA BOUCLE
  const isAuthenticated = useAuth((state: any) => state.isAuthenticated);
  const setAuth = useAuth((state: any) => state.setAuth);

  const [mode, setMode] = useState<Mode>('picker');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Formulaire « Demander un accès »
  const [requestName, setRequestName] = useState('');
  const [requestEmail, setRequestEmail] = useState('');
  const [requestSent, setRequestSent] = useState(false);

  // Formulaire « J'ai un code d'invitation »
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [registerPin, setRegisterPin] = useState('');
  const [registerPinConfirm, setRegisterPinConfirm] = useState('');
  const [colorHex, setColorHex] = useState(AVATAR_COLORS[0]);

  // Lien reçu par email : /?invite=COLOC-XXXX&email=…
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite')?.trim();
    if (!invite) return;

    const invitedEmail = params.get('email')?.trim() ?? '';
    setInviteCode(invite.toUpperCase());
    if (invitedEmail) setRegisterEmail(invitedEmail);
    setMode('register');
  }, []);

  const passwordChecks = useMemo(
    () => PASSWORD_RULES.map((rule) => ({ label: rule.label, ok: rule.test(registerPassword) })),
    [registerPassword],
  );
  const passwordValid = passwordChecks.every((check) => check.ok);

  const pinComplete = /^\d{4}$/.test(registerPin);
  const pinError = !pinComplete
    ? ''
    : isWeakPin(registerPin)
      ? 'Code trop facile à deviner (0000, 1234, année…).'
      : registerPinConfirm.length === 4 && registerPinConfirm !== registerPin
        ? 'Les deux codes ne correspondent pas.'
        : '';
  const pinValid = pinComplete && !pinError && registerPinConfirm === registerPin;

  // Si déjà connecté, on n'affiche rien
  if (isAuthenticated) return null;

  /** Revient au sélecteur en effaçant les messages transitoires. */
  const backToPicker = () => {
    setMode('picker');
    setError('');
    setNotice('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.login(email, password);
      setAuth(response.tokens.accessToken, response.tokens.refreshToken, response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Identifiants invalides');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await api.requestInvite({ name: requestName.trim(), email: requestEmail.trim() });
      setRequestSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demande impossible pour le moment');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordValid) {
      setError('Le mot de passe ne respecte pas les règles de sécurité.');
      return;
    }
    if (!pinValid) {
      setError(pinError || 'Choisis et confirme ton code PIN à 4 chiffres.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await api.register({
        name: registerName.trim(),
        email: registerEmail.trim(),
        password: registerPassword,
        inviteCode: inviteCode.trim().toUpperCase(),
        colorHex,
        pin: registerPin,
      });
      // Connexion immédiate : le store persiste la session.
      setAuth(response.tokens.accessToken, response.tokens.refreshToken, response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inscription impossible');
    } finally {
      setLoading(false);
    }
  };

  // Écran par défaut : mosaïque des profils + pavé PIN
  if (mode === 'picker') {
    return (
      <ProfilePickerModal
        onUsePassword={() => setMode('password')}
        onRequestAccess={() => {
          setMode('request');
          setRequestSent(false);
        }}
        onUseInviteCode={() => setMode('register')}
      />
    );
  }

  const isRegister = mode === 'register';
  const isRequest = mode === 'request';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-xl px-4 py-6 overflow-y-auto">
      <div className="w-full max-w-sm rounded-[26px] border border-white/10 bg-slate-900/70 backdrop-blur-2xl backdrop-saturate-150 p-5 shadow-glass-lg">
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={backToPicker}
            aria-label="Revenir au choix du profil"
            className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-slate-400 tap hover:text-white"
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <h2 className="font-display text-base text-text-primary leading-tight">
              {isRegister ? "Code d'invitation" : isRequest ? 'Demander un accès' : 'Connexion'}
            </h2>
            <p className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
              {isRegister
                ? 'Créer mon compte'
                : isRequest
                  ? 'Validation par un administrateur'
                  : 'Email & mot de passe'}
            </p>
          </div>
        </div>

        {/* ── Connexion email / mot de passe ─────────────────────────────── */}
        {mode === 'password' && (
          <>
            <form onSubmit={handleLogin} className="space-y-3">
              <label className="flex flex-col gap-1">
                <span className="label-micro">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className={fieldClass}
                  required
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="label-micro">Mot de passe</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className={fieldClass}
                  required
                />
              </label>

              {error && <p className="font-body text-[11px] text-red-300">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-2xl border border-accent/40 bg-accent/15 text-accent
                           font-mono text-[11px] tracking-wider uppercase tap ease-ios
                           hover:bg-accent/25 disabled:opacity-50 transition-all"
              >
                {loading ? 'Connexion…' : 'Entrer dans la coloc'}
              </button>
            </form>

            <div className="mt-4 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setRequestSent(false);
                }}
                className="font-mono text-2xs text-text-tertiary hover:text-accent transition-colors inline-flex items-center gap-1.5"
              >
                <Ticket size={12} /> J&apos;ai un code d&apos;invitation
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('request');
                  setRequestSent(false);
                }}
                className="font-mono text-2xs text-text-tertiary hover:text-accent transition-colors inline-flex items-center gap-1.5"
              >
                <UserPlus size={12} /> Demander un accès
              </button>
            </div>
          </>
        )}

        {/* ── Demande d'accès ─────────────────────────────────────────────── */}
        {isRequest && (
          <>
            {requestSent ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-3">
                  <CheckCircle2 size={16} className="text-emerald-300 mt-0.5 shrink-0" />
                  <p className="font-body text-[12px] text-emerald-100 leading-relaxed">
                    Demande envoyée à l&apos;administrateur. Vous recevrez un code
                    d&apos;invitation par email une fois la demande approuvée.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={backToPicker}
                  className="w-full h-11 rounded-2xl border border-white/10 bg-white/5 text-slate-200 font-mono text-[11px] tracking-wider uppercase tap"
                >
                  Retour à l&apos;accueil
                </button>
              </div>
            ) : (
              <form onSubmit={handleRequestInvite} className="space-y-3">
                <label className="flex flex-col gap-1">
                  <span className="label-micro">Prénom</span>
                  <input
                    type="text"
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                    autoComplete="given-name"
                    className={fieldClass}
                    required
                    minLength={2}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="label-micro">Email</span>
                  <input
                    type="email"
                    value={requestEmail}
                    onChange={(e) => setRequestEmail(e.target.value)}
                    autoComplete="email"
                    className={fieldClass}
                    required
                  />
                </label>

                {error && <p className="font-body text-[11px] text-red-300">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-2xl border border-accent/40 bg-accent/15 text-accent
                             font-mono text-[11px] tracking-wider uppercase tap ease-ios
                             hover:bg-accent/25 disabled:opacity-50 transition-all"
                >
                  {loading ? 'Envoi…' : "Envoyer la demande"}
                </button>

                <p className="font-body text-[10px] text-slate-500 leading-relaxed">
                  Un administrateur de la coloc valide chaque demande manuellement.
                </p>
              </form>
            )}
          </>
        )}

        {/* ── Inscription avec code d'invitation ──────────────────────────── */}
        {isRegister && (
          <form onSubmit={handleRegister} className="space-y-3">
            <label className="flex flex-col gap-1">
              <span className="label-micro">Prénom</span>
              <input
                type="text"
                value={registerName}
                onChange={(e) => setRegisterName(e.target.value)}
                autoComplete="given-name"
                className={fieldClass}
                required
                minLength={2}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="label-micro">Email</span>
              <input
                type="email"
                value={registerEmail}
                onChange={(e) => setRegisterEmail(e.target.value)}
                autoComplete="email"
                className={fieldClass}
                required
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="label-micro">Mot de passe</span>
              <input
                type="password"
                value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)}
                autoComplete="new-password"
                className={fieldClass}
                required
              />
            </label>

            <ul className="grid grid-cols-2 gap-1">
              {passwordChecks.map((check) => (
                <li
                  key={check.label}
                  className={`font-mono text-[9px] flex items-center gap-1 ${
                    check.ok ? 'text-emerald-300' : 'text-slate-500'
                  }`}
                >
                  <span aria-hidden>{check.ok ? '●' : '○'}</span> {check.label}
                </li>
              ))}
            </ul>

            {/* PIN choisi tout de suite : le profil est prêt dans le sélecteur */}
            <div className="flex flex-col gap-1">
              <span className="label-micro">Code PIN (4 chiffres, pour te reconnecter vite)</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={registerPin}
                  onChange={(e) => setRegisterPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  autoComplete="new-password"
                  aria-label="Code PIN"
                  className={`${fieldClass} font-mono tracking-[0.5em] text-center`}
                  required
                />
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={registerPinConfirm}
                  onChange={(e) => setRegisterPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Confirmer"
                  autoComplete="new-password"
                  aria-label="Confirmer le code PIN"
                  className={`${fieldClass} font-mono tracking-[0.5em] text-center`}
                  required
                />
              </div>
              {pinError && <p className="font-body text-[10px] text-red-300">{pinError}</p>}
            </div>

            <label className="flex flex-col gap-1">
              <span className="label-micro">Code d&apos;invitation</span>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="COLOC-XXXX"
                autoComplete="one-time-code"
                spellCheck={false}
                className={`${fieldClass} font-mono tracking-widest uppercase`}
                required
              />
            </label>

            <div className="flex flex-col gap-1">
              <span className="label-micro">Couleur d&apos;avatar</span>
              <div className="flex gap-2">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setColorHex(color)}
                    aria-label={`Couleur ${color}`}
                    aria-pressed={colorHex === color}
                    className={`w-7 h-7 rounded-full tap transition-transform ${
                      colorHex === color ? 'ring-2 ring-white scale-110' : 'opacity-70'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {error && <p className="font-body text-[11px] text-red-300">{error}</p>}
            {notice && <p className="font-body text-[11px] text-emerald-300">{notice}</p>}

            <button
              type="submit"
              disabled={loading || !passwordValid || !pinValid}
              className="w-full h-11 rounded-2xl border border-accent/40 bg-accent/15 text-accent
                         font-mono text-[11px] tracking-wider uppercase tap ease-ios
                         hover:bg-accent/25 disabled:opacity-40 transition-all inline-flex items-center justify-center gap-2"
            >
              <KeyRound size={13} />
              {loading ? 'Création…' : 'Créer mon compte'}
            </button>
          </form>
        )}

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={backToPicker}
            className="font-mono text-2xs text-text-tertiary hover:text-accent transition-colors"
          >
            ← Revenir aux profils
          </button>
        </div>
      </div>
    </div>
  );
};

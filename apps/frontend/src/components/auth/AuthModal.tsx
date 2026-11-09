import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/store';
import { api } from '@/api/client';
import { ProfilePickerModal } from '@/components/auth/ProfilePickerModal';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — AuthModal
//
// Écran d'accueil : sélecteur de profils « Qui cuisine aujourd'hui ? » (code
// PIN 4 chiffres) avec repli sur la connexion email / mot de passe historique.
// La session (JWT 30 jours pour le flux PIN) est persistée par le store.
// ─────────────────────────────────────────────────────────────────────────────

export const AuthModal = () => {
  // ✅ ON SÉPARE LES SÉLECTEURS POUR ÉVITER LA BOUCLE
  const isAuthenticated = useAuth((state: any) => state.isAuthenticated);
  const setAuth = useAuth((state: any) => state.setAuth);
  
  const [mode, setMode] = useState<'picker' | 'password'>('picker');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Si déjà connecté, on n'affiche rien
  if (isAuthenticated) return null;

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

  // Écran par défaut : mosaïque des profils + pavé PIN
  if (mode === 'picker') {
    return <ProfilePickerModal onUsePassword={() => setMode('password')} />;
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-xl px-4">
      <div className="w-full max-w-sm rounded-[26px] border border-white/10 bg-slate-900/70 backdrop-blur-2xl backdrop-saturate-150 p-5 shadow-glass-lg">
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => setMode('picker')}
            aria-label="Revenir au choix du profil"
            className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-slate-400 tap hover:text-white"
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <h2 className="font-display text-base text-text-primary leading-tight">Connexion</h2>
            <p className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
              Email &amp; mot de passe
            </p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="label-micro">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 font-body text-sm text-white focus:outline-none focus:border-accent/60"
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
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 font-body text-sm text-white focus:outline-none focus:border-accent/60"
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

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setMode('picker')}
            className="font-mono text-2xs text-text-tertiary hover:text-accent transition-colors"
          >
            ← Revenir aux profils
          </button>
        </div>
      </div>
    </div>
  );
};
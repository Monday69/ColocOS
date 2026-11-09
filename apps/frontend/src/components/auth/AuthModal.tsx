import React, { useState } from 'react';
import { useAuth } from '@/store';
import { api } from '@/api/client';

export const AuthModal = () => {
  // ✅ ON SÉPARE LES SÉLECTEURS POUR ÉVITER LA BOUCLE
  const isAuthenticated = useAuth((state: any) => state.isAuthenticated);
  const setAuth = useAuth((state: any) => state.setAuth);
  
  const [email, setEmail] = useState('matteo@colocos.local');
  const [password, setPassword] = useState('coloc2026');
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
      
      // ✅ Correction : on accède à response.tokens.accessToken
      // et response.tokens.refreshToken
      setAuth(
        response.tokens.accessToken, 
        response.tokens.refreshToken, 
        response.user
      );
      
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Identifiants invalides');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-md p-8 bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl">
        <h2 className="text-2xl font-bold text-white mb-2">ColocOS — Connexion</h2>
        <p className="text-gray-400 text-sm mb-6">Entrez vos accès pour piloter le Digital Twin.</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Email</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-blue-500/50"
              required
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Mot de passe</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-blue-500/50"
              required
            />
          </div>

          {error && <p className="text-red-400 text-xs italic">{error}</p>}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-white text-black font-bold py-3 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {loading ? 'Authentification...' : 'ENTRER DANS LA COLOC'}
          </button>
        </form>
      </div>
    </div>
  );
};
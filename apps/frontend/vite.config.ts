import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Vite config
//
// HTTPS + host 0.0.0.0 : indispensable pour tester la caméra depuis un
// smartphone sur le LAN (getUserMedia exige un contexte sécurisé ; l'IP locale
// en HTTP est refusée par les navigateurs mobiles).
//
// Les appels API utilisent une URL RELATIVE (/api) proxyfiée ici : le front
// fonctionne donc à l'identique en localhost et depuis le téléphone
// (https://192.168.x.x:5173 → /api → http://localhost:3001 côté machine hôte).
// ─────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // strictPort : échoue au lieu de glisser sur 5174 (le certificat et les
    // URLs partagées resteraient sinon incohérents)
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});

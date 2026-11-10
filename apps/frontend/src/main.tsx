import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// ── Rafraîchissement du Service Worker à chaque chargement ───────────────────
// `update()` force la revalidation de /sw.js (servi en no-store par Caddy) :
// dès qu'une nouvelle version est déployée, elle prend la main au reload suivant
// (le SW appelle skipWaiting + clients.claim).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .getRegistration('/')
      .then((registration) => registration?.update())
      .catch(() => {
        /* pas de SW enregistré (ou contexte non sécurisé) — silencieux */
      });
  });
}

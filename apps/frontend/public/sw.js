/* ─────────────────────────────────────────────────────────────────────────────
 * ColocOS — Service Worker (Web Push)
 *
 * Rôle unique : afficher les notifications de péremption et exécuter l'action
 * rapide « 🤝 Mettre en libre-service » sans ouvrir l'application.
 *
 * NOTE AUTH : ce contexte n'a pas accès au `localStorage`, donc pas au JWT de
 * session. Le backend joint au push un jeton d'action signé (`data.token`),
 * limité à un item et à l'action « share ».
 * ───────────────────────────────────────────────────────────────────────────*/

const ICON = '/icons/icon-192.png';
const BADGE = '/icons/icon-72.png';

/**
 * Version du Service Worker — à incrémenter à chaque déploiement qui doit
 * forcer une mise à jour immédiate sur les appareils déjà installés.
 * v1.1 : activation sans attendre + reprise des onglets ouverts + purge des
 * anciens caches `colocos-*`.
 */
const SW_VERSION = 'colocos-v1.1';

self.addEventListener('install', (event) => {
  // Active la nouvelle version sans attendre la fermeture des onglets.
  self.skipWaiting();
  event.waitUntil(Promise.resolve(SW_VERSION));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Purge des caches d'une version précédente (le SW n'en crée aucun
      // aujourd'hui, mais des versions antérieures ont pu en laisser).
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((key) => key.startsWith('colocos-') && key !== SW_VERSION)
            .map((key) => caches.delete(key)),
        );
      }
      // Prend le contrôle des onglets déjà ouverts (iOS : pas de reload manuel).
      await self.clients.claim();
    })(),
  );
});

/** Exposé pour diagnostic depuis la console : `navigator.serviceWorker.controller`. */
self.COLOCOS_SW_VERSION = SW_VERSION;

self.addEventListener('push', (event) => {
  let payload = { title: 'ColocOS', body: '', data: {} };

  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload = { ...payload, body: event.data.text() };
  }

  const data = payload.data || {};
  const itemId = data.itemId;

  const options = {
    body: payload.body || '',
    icon: ICON,
    badge: BADGE,
    vibrate: [100, 50, 100],
    tag: itemId ? `expiry-${itemId}` : 'colocos',
    renotify: true,
    data: { ...data, url: data.url || '/' },
    actions: [
      { action: 'share', title: '🤝 Mettre en libre-service' },
      { action: 'open', title: 'Ouvrir ColocOS' },
    ],
  };

  event.waitUntil(self.registration.showNotification(payload.title || 'ColocOS', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const itemId = data.itemId;

  if (event.action === 'share' && itemId) {
    event.waitUntil(
      shareItem(itemId, data.token).then((ok) => {
        return self.registration.showNotification(
          ok ? '🤝 En libre-service' : '⚠️ Action impossible',
          {
            body: ok
              ? 'Le produit est visible par tous les colocataires.'
              : "La mise en libre-service a échoué — ouvre ColocOS pour réessayer.",
            icon: ICON,
            badge: BADGE,
            tag: `share-${itemId}`,
            data: { url: '/' },
          },
        );
      }),
    );
    return;
  }

  event.waitUntil(openApp(data.url || '/'));
});

/**
 * POST /api/items/:id/share avec le jeton d'action du payload.
 * Repli : le backend répond 401 si le jeton a expiré (7 jours).
 */
async function shareItem(itemId, token) {
  try {
    const response = await fetch(`/api/items/${itemId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(token ? { token } : {}),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Focalise une fenêtre ColocOS déjà ouverte, sinon en ouvre une. */
async function openApp(url) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  for (const client of all) {
    if ('focus' in client) {
      try {
        await client.navigate(url);
      } catch {
        /* navigate n'est pas toujours autorisé — focus suffit */
      }
      return client.focus();
    }
  }

  return self.clients.openWindow(url);
}

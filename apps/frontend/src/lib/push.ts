import { api } from '@/api/client';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Client Web Push (PWA)
//
// Trois étapes, dans cet ordre :
//   1. enregistrer le Service Worker `/sw.js` ;
//   2. demander la permission native (`Notification.requestPermission`) ;
//   3. `pushManager.subscribe` avec la clé VAPID, puis POST /notifications/subscribe.
//
// La clé publique vient de `VITE_VAPID_PUBLIC_KEY` (build) ou, à défaut, de
// `GET /api/notifications/public-key` : un environnement sans build-arg ne
// casse pas l'activation.
// ─────────────────────────────────────────────────────────────────────────────

export type PushPermission = NotificationPermission | 'unsupported';

export interface PushStatus {
  supported: boolean;
  permission: PushPermission;
  subscribed: boolean;
  /** Clé VAPID présente côté serveur (sinon l'envoi est désactivé) */
  serverConfigured: boolean;
}

export interface PushEnableResult extends PushStatus {
  endpoint: string | null;
}

const SW_URL = '/sw.js';

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Conversion base64url (VAPID) → Uint8Array, format attendu par `subscribe`. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));

  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }

  return output;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  const existing = await navigator.serviceWorker.getRegistration(SW_URL);
  if (existing) return existing;

  const registered = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  await navigator.serviceWorker.ready;
  return registered;
}

async function resolveVapidKey(): Promise<string> {
  const fromEnv = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();

  const { publicKey } = await api.getPushPublicKey();
  if (!publicKey) {
    throw new Error('Notifications non configurées côté serveur (clé VAPID absente).');
  }
  return publicKey;
}

/** État courant, sans rien modifier. */
export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) {
    return { supported: false, permission: 'unsupported', subscribed: false, serverConfigured: false };
  }

  let serverConfigured = false;
  let serverSubscriptions = 0;
  try {
    const status = await api.getPushServerStatus();
    serverConfigured = status.configured;
    serverSubscriptions = status.subscriptions;
  } catch {
    // Réseau / session : on n'empêche pas l'utilisateur de tenter l'activation.
  }

  const registration = await getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;

  // Auto-réparation : abonnement présent dans le navigateur mais absent côté
  // serveur (base réinitialisée, autre compte) → on le ré-enregistre, sinon
  // l'UI afficherait « activé » sans qu'aucune notification ne puisse arriver.
  if (subscription && serverSubscriptions === 0) {
    try {
      const json = subscription.toJSON();
      if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
        await api.subscribePush({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        });
      }
    } catch {
      // Échec silencieux : l'utilisateur pourra re-cliquer sur la cloche.
    }
  }

  return {
    supported: true,
    permission: Notification.permission,
    subscribed: subscription !== null,
    serverConfigured,
  };
}

/**
 * Active les notifications : SW → permission → souscription → enregistrement
 * serveur. Lève une erreur explicite (affichée en toast) si un maillon casse.
 */
export async function enablePush(): Promise<PushEnableResult> {
  if (!isPushSupported()) {
    throw new Error("Ce navigateur ne supporte pas les notifications push (iOS < 16.4 ou HTTP).");
  }

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();

  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications bloquées : autorise-les dans les réglages du navigateur.'
        : 'Permission refusée.',
    );
  }

  const registration = await getRegistration();
  if (!registration) throw new Error('Service Worker indisponible.');

  const applicationServerKey = urlBase64ToUint8Array(await resolveVapidKey());

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    }));

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Abonnement push incomplet renvoyé par le navigateur.');
  }

  await api.subscribePush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });

  return {
    supported: true,
    permission: 'granted',
    subscribed: true,
    serverConfigured: true,
    endpoint: json.endpoint,
  };
}

/** Désactive : supprime l'abonnement côté navigateur ET côté serveur. */
export async function disablePush(): Promise<PushStatus> {
  const registration = await getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;

  if (subscription) {
    try {
      await api.unsubscribePush(subscription.endpoint);
    } catch {
      // L'échec serveur ne doit pas empêcher le désabonnement local.
    }
    await subscription.unsubscribe();
  }

  return getPushStatus();
}

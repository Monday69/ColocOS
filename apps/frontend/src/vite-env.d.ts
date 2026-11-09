/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clé publique VAPID (Web Push) — peut aussi venir de /api/notifications/public-key */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

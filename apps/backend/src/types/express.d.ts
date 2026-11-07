// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Express Type Augmentation
//
// Ce fichier est la SOURCE UNIQUE de vérité pour l'augmentation du type
// Express.Request. Il est automatiquement chargé par TypeScript grâce à
// l'option "include" du tsconfig.
//
// IMPORTANT : Ne pas redéclarer ce namespace ailleurs dans le codebase
// (notamment dans auth.middleware.ts) pour éviter les conflits de types.
// ─────────────────────────────────────────────────────────────────────────────

declare namespace Express {
  interface Request {
    /**
     * Utilisateur authentifié, injecté par le middleware `authenticate`.
     * Undefined sur les routes publiques (health, auth).
     */
    user?: {
      id: string;
      email: string;
      name: string;
      colorHex: string;
      avatarUrl: string | null;
    };
  }
}
// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Digital Twin Types
//
// DEUX NIVEAUX DE PAYLOAD intentionnellement séparés :
//
//   ZoneTwin   → payload ultra-léger pour hydrater Three.js en une passe.
//                Chaque champ a un usage 3D direct (couleur mesh, icône, etc.)
//                Cible : ~200–400 bytes par zone, ~4–6 KB pour tout le frigo.
//
//   ZoneDetail → payload complet pour le panneau latéral (clic sur un mesh).
//                Contient les items complets, les métadonnées, la hiérarchie.
// ─────────────────────────────────────────────────────────────────────────────

// ── Constantes de seuil (aussi utilisées côté Frontend pour la légende) ──────

export const HEALTH_THRESHOLDS = {
  CRITICAL_DAYS: 2,   // DLC dans ≤ 2 jours → rouge
  WARNING_DAYS: 7,    // DLC dans ≤ 7 jours → orange
  FILL_FULL: 0.9,     // ≥ 90% capacité → zone "pleine"
  FILL_LOW: 0.15,     // ≤ 15% capacité → zone "presque vide"
} as const;

// ── HealthStatus ──────────────────────────────────────────────────────────────

export type HealthStatus =
  | 'critical'  // Un item expire dans ≤ 2 jours
  | 'warning'   // Un item expire dans ≤ 7 jours
  | 'ok'        // Tout va bien
  | 'empty';    // Zone vide

// ── FillStatus ────────────────────────────────────────────────────────────────

export type FillStatus =
  | 'full'      // ≥ 90% de la capacité
  | 'medium'    // 15–90%
  | 'low'       // ≤ 15%
  | 'empty';    // 0 item

// ── ZoneTwin — Payload léger pour Three.js ───────────────────────────────────

export interface ZoneTwin {
  /** ID du mesh dans le modèle GLTF — clé de mapping 3D↔BDD */
  meshId: string;

  /** Ratio d'occupation 0..1 — pilote la teinte/opacité du mesh */
  fillRatio: number;

  /** Statut qualitatif du remplissage */
  fillStatus: FillStatus;

  /** Statut de santé basé sur les DLC — pilote la couleur d'alerte */
  healthStatus: HealthStatus;

  /** Nombre d'items dans la zone — affiché en badge 3D */
  itemCount: number;

  /**
   * Couleurs hex des propriétaires présents dans la zone.
   * Dédupliquées, max 6 (un par colocataire).
   * Utilisées pour l'éclairage dynamique (point lights colorés au-dessus de la zone).
   * Ex: ["#6366F1", "#EC4899"] → deux colocataires ont des items ici
   */
  ownerColors: string[];

  /**
   * Nombre de jours avant la prochaine expiration dans la zone.
   * null si aucun item avec DLC, ou si zone vide.
   * Utilisé pour afficher un countdown en overlay 3D.
   */
  nextExpiryDays: number | null;

  /** Type de zone — permet au frontend de choisir l'icône/overlay */
  type: 'fridge' | 'freezer' | 'pantry' | 'cabinet';

  /**
   * Projection minimale des items de la zone — sert au rendu procédural 3D
   * (packagings posés sur les clayettes). Volontairement sans brand/expiry :
   * le panneau latéral utilise GET /fridge/zones/:meshId pour le détail complet.
   */
  items: ZoneItemTwin[];
}

/** Item allégé pour l'instanciation des meshes produit côté Three.js. */
export interface ZoneItemTwin {
  id: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unit: string;
  /** Couleur du colocataire propriétaire (teinte du socle 3D) */
  ownerColorHex: string | null;
  isShared: boolean;
  daysUntilExpiry: number | null;
  /** Marque (tooltip produit sur le mesh 3D) */
  brand: string | null;
  /** Nutriscore A–E, null si inconnu */
  nutriscore: string | null;
  /** Prénom du propriétaire (pastille du tooltip) */
  ownerName: string | null;
  /** Date de péremption ISO courte (YYYY-MM-DD), null si non renseignée */
  expiryDate: string | null;
}

/** Payload complet retourné par GET /api/fridge/state */
export interface FridgeStateTwin {
  /** Map indexée par meshId pour un accès O(1) depuis Three.js */
  zones: Record<string, ZoneTwin>;

  /** Statistiques globales du frigo pour le dashboard */
  summary: FridgeSummary;

  /** ISO timestamp — permet au frontend de savoir si le cache est frais */
  computedAt: string;
}

export interface FridgeSummary {
  totalItems: number;
  criticalZones: number;   // Zones avec healthStatus === 'critical'
  warningZones: number;
  emptyZones: number;
  fullZones: number;
  expiringThisWeek: number; // Items qui expirent dans les 7 prochains jours
}

// ── ZoneDetail — Payload complet pour le panneau latéral ─────────────────────

export interface ZoneItemDetail {
  id: string;
  name: string;
  brand: string | null;
  quantity: number;
  unit: string;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
  imageUrl: string | null;
  nutriscore: string | null;
  isShared: boolean;
  owner: {
    id: string;
    name: string;
    colorHex: string;
  } | null;
}

export interface ZoneDetail {
  id: string;
  meshId: string;
  label: string;
  type: 'fridge' | 'freezer' | 'pantry' | 'cabinet';
  capacityLiters: number | null;

  // Métriques calculées
  fillRatio: number;
  fillStatus: FillStatus;
  healthStatus: HealthStatus;
  nextExpiryDays: number | null;
  ownerColors: string[];

  // Position 3D (pour le frontend si besoin de positionner des overlays)
  position: { x: number; y: number; z: number } | null;

  // Hiérarchie
  parentMeshId: string | null;
  childMeshIds: string[];

  // Items complets
  items: ZoneItemDetail[];
  itemCount: number;
}
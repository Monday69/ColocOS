// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Shared Types
// Utilisés par Backend ET Frontend (via le workspace packages/shared)
// ─────────────────────────────────────────────────────────────────────────────

// ── API Response wrapper ────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface ApiError {
  success: false;
  error: string;
  details?: Record<string, string[]>;
  statusCode: number;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  colorHex: string;
  /** Identifiant de connexion (mode USERNAME_PIN) */
  username: string | null;
  /** Mode d'authentification exigé pour ce profil */
  authMode: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

// ── Digital Twin ─────────────────────────────────────────────────────────────

export interface StorageZoneState {
  meshId: string;
  label: string;
  type: 'fridge' | 'freezer' | 'pantry' | 'cabinet';
  items: ItemSummary[];
  itemCount: number;
  fillRatio: number; // 0..1 — pour le feedback visuel 3D
  hasExpiredItems: boolean;
}

export interface FridgeState {
  zones: StorageZoneState[];
  lastUpdated: string; // ISO date
}

// ── Inventory ────────────────────────────────────────────────────────────────

export interface ItemSummary {
  id: string;
  name: string;
  brand: string | null;
  quantity: number;
  unit: string;
  expiryDate: string | null;
  imageUrl: string | null;
  nutriscore: string | null;
  isShared: boolean;
  ownerId: string | null;
  /** Quantité de référence (jauge de niveau) */
  initialQuantity: number;
  /** Renseigné quand l'article est terminé (soft-delete) */
  consumedAt: string | null;
  // ── Nutrition (pour 100 g / 100 ml) ──
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  fat: number | null;
  fiber: number | null;
  novaGroup: number | null;
}

export interface ScannedProduct {
  barcode: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  nutriscore: string | null;
  quantity: string | null; // "500g", "1L", etc. (chaîne brute OFF)
  fromCache: boolean;
  /** Données nutritionnelles Open Food Facts (pour 100 g / 100 ml) */
  nutrition: ProductNutrition;
}

export interface ProductNutrition {
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  fat: number | null;
  fiber: number | null;
  novaGroup: number | null;
}

// ── Finance ──────────────────────────────────────────────────────────────────

export interface UserBalance {
  userId: string;
  name: string;
  colorHex: string;
  netBalance: number; // positif = créditeur, négatif = débiteur
}

export interface SettlementTransaction {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amount: number;
}

export interface BalanceReport {
  userBalances: UserBalance[];
  settlements: SettlementTransaction[];
  totalExpenses: number;
}

// ── Recipes ──────────────────────────────────────────────────────────────────

export interface RecipeSuggestion {
  id: string;
  title: string;
  imageUrl: string | null;
  sourceUrl: string;
  prepTimeMin: number | null;
  matchScore: number; // 0..1 — % d'ingrédients disponibles en stock
  missingIngredients: string[];
  /** meshIds des zones 3D qui contiennent les ingrédients disponibles */
  availableInMeshIds?: string[];
}
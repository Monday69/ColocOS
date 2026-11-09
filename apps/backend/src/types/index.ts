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
}

export interface ScannedProduct {
  barcode: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  nutriscore: string | null;
  quantity: string | null; // "500g", "1L", etc. (chaîne brute OFF)
  fromCache: boolean;
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
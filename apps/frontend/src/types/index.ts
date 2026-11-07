// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Frontend Types (Sprint 5 — Finance + Shopping)
// ─────────────────────────────────────────────────────────────────────────────

export type HealthStatus = 'critical' | 'warning' | 'ok' | 'empty';
export type FillStatus   = 'full' | 'medium' | 'low' | 'empty';

export interface ZoneTwin {
  meshId: string;
  fillRatio: number;
  fillStatus: FillStatus;
  healthStatus: HealthStatus;
  itemCount: number;
  ownerColors: string[];
  nextExpiryDays: number | null;
  type: 'fridge' | 'freezer' | 'pantry' | 'cabinet';
}

export interface FridgeSummary {
  totalItems: number;
  criticalZones: number;
  warningZones: number;
  emptyZones: number;
  fullZones: number;
  expiringThisWeek: number;
}

export interface FridgeStateTwin {
  zones: Record<string, ZoneTwin>;
  summary: FridgeSummary;
  computedAt: string;
}

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
  owner: { id: string; name: string; colorHex: string } | null;
}

export interface ZoneDetail {
  id: string;
  meshId: string;
  label: string;
  type: 'fridge' | 'freezer' | 'pantry' | 'cabinet';
  capacityLiters: number | null;
  fillRatio: number;
  fillStatus: FillStatus;
  healthStatus: HealthStatus;
  nextExpiryDays: number | null;
  ownerColors: string[];
  position: { x: number; y: number; z: number } | null;
  parentMeshId: string | null;
  childMeshIds: string[];
  items: ZoneItemDetail[];
  itemCount: number;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  colorHex: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  meta?: { total?: number; page?: number; limit?: number };
}

export interface ZoneLayout {
  meshId: string;
  position: [number, number, number];
  size: [number, number, number];
  label: string;
  group: 'fridge' | 'freezer' | 'door' | 'cabinet_left' | 'cabinet_right' | 'pantry';
}

// ── Finance ───────────────────────────────────────────────────────────────────

export interface UserBalance {
  userId: string;
  name: string;
  colorHex: string;
  totalPaid: number;
  totalOwed: number;
  netBalance: number; // positif = créditeur, négatif = débiteur
}

export interface DebtTransaction {
  fromUserId: string;
  fromName: string;
  fromColorHex: string;
  toUserId: string;
  toName: string;
  toColorHex: string;
  amount: number;
}

export interface MonthlyStats {
  month: number;
  year: number;
  totalSpent: number;
  expenseCount: number;
  byCategory: Record<string, number>;
}

export interface FinanceStatus {
  currentUser: UserBalance;
  allBalances: UserBalance[];
  simplifiedDebts: DebtTransaction[];
  monthlyStats: MonthlyStats;
}

export interface ExpenseWithSplits {
  id: string;
  description: string;
  amount: number;
  category: string;
  paidBy: { id: string; name: string; colorHex: string };
  splits: Array<{
    userId: string;
    userName: string;
    shareAmount: number;
    isSettled: boolean;
  }>;
  createdAt: string;
}

// ── Shopping ──────────────────────────────────────────────────────────────────

export type ShoppingItemStatus = 'pending' | 'checked' | 'purchased';

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  barcode: string | null;
  status: ShoppingItemStatus;
  note: string | null;
  isAutoSuggested: boolean;
  createdAt: string;
  addedBy: { id: string; name: string; colorHex: string } | null;
}

export interface ShoppingList {
  id: string;
  name: string;
  isArchived: boolean;
  items: ShoppingItem[];
}

// ── Navigation ────────────────────────────────────────────────────────────────

// AppModule moved to end of file — extended below

// ── Scanner ───────────────────────────────────────────────────────────────────

export interface ScannedProduct {
  barcode: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  nutriscore: string | null;
  quantity: string | null;
  fromCache: boolean;
  /** Données nutritionnelles (si disponibles depuis OpenFoodFacts) */
  nutriments?: {
    energy_kcal?: number;
    proteins?: number;
    carbohydrates?: number;
    fat?: number;
  };
}

export interface AddToInventoryPayload {
  barcode?: string;
  name: string;
  brand?: string | null;
  imageUrl?: string | null;
  nutriscore?: string | null;
  quantity: number;
  unit: string;
  storageZoneId: string;
  expiryDate?: string | null;
  isShared: boolean;
}

// ── Recipes ───────────────────────────────────────────────────────────────────

export interface RecipeSuggestion {
  id: string;
  title: string;
  imageUrl: string | null;
  sourceUrl: string;
  prepTimeMin: number | null;
  matchScore: number; // 0..1 — % d'ingrédients disponibles
  missingIngredients: string[];
  /** meshIds des zones qui contiennent les ingrédients disponibles */
  availableInMeshIds?: string[];
}

// ── Navigation (extended) ─────────────────────────────────────────────────────

export type AppModule = 'fridge' | 'finance' | 'shopping' | 'scanner' | 'recipes';
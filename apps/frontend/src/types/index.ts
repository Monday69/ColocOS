// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Frontend Types (Sprint 5 — Finance + Shopping)
// ─────────────────────────────────────────────────────────────────────────────

export type HealthStatus = 'critical' | 'warning' | 'ok' | 'empty';
export type FillStatus   = 'full' | 'medium' | 'low' | 'empty';

export interface ZoneItemTwin {
  id: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unit: string;
  ownerColorHex: string | null;
  isShared: boolean;
  daysUntilExpiry: number | null;
  /** Marque (tooltip produit sur le mesh 3D) */
  brand: string | null;
  /** Nutriscore A–E, null si inconnu */
  nutriscore: string | null;
  /** Prénom du propriétaire (pastille du tooltip) */
  ownerName: string | null;
  /** Péremption ISO courte (YYYY-MM-DD), null si non renseignée */
  expiryDate: string | null;
  /** Quantité de référence de l'article (jauge de niveau) */
  initialQuantity: number;
  /** Macros Open Food Facts (pour 100 g / 100 ml) */
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  fat: number | null;
  fiber: number | null;
  /** Classification NOVA 1 → 4 (degré de transformation) */
  novaGroup: number | null;
}

export interface ZoneTwin {
  meshId: string;
  fillRatio: number;
  fillStatus: FillStatus;
  healthStatus: HealthStatus;
  itemCount: number;
  ownerColors: string[];
  nextExpiryDays: number | null;
  type: 'fridge' | 'freezer' | 'pantry' | 'cabinet';
  /** Projection 3D des items (packagings) */
  items: ZoneItemTwin[];
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

/** Ligne envoyée au journal nutritionnel (macros déjà calculées côté client). */
export interface LoggedMealItemPayload {
  name: string;
  barcode?: string | null;
  grams: number;
  calories: number;
  proteins: number;
  carbs: number;
  fat: number;
}

export interface LoggedMealPayload {
  userId?: string | null;
  date?: string;
  items: LoggedMealItemPayload[];
}

export interface LoggedMealItem extends LoggedMealItemPayload {
  id: string;
}

export interface LoggedMeal {
  id: string;
  userId: string | null;
  date: string;
  createdAt: string;
  totalCalories: number;
  totalProteins: number;
  totalCarbs: number;
  totalFat: number;
  items: LoggedMealItem[];
}

/** Agrégat d'une journée du journal nutritionnel. */
export interface MealDayHistory {
  date: string;
  mealCount: number;
  totalCalories: number;
  totalProteins: number;
  totalCarbs: number;
  totalFat: number;
}

export interface MealDaySummary {
  date: string;
  mealCount: number;
  itemCount: number;
  totalCalories: number;
  totalProteins: number;
  totalCarbs: number;
  totalFat: number;
  meals: LoggedMeal[];
}

export interface ScannedProduct {
  barcode: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  nutriscore: string | null;
  quantity: string | null;
  fromCache: boolean;
  /** Énergie pour 100 g — renvoyée à plat par le ScannerService (OFF) */
  kcalPer100g?: number | null;
  /** Données nutritionnelles structurées Open Food Facts */
  nutrition?: ProductNutrition;
}

/** Macros Open Food Facts (pour 100 g / 100 ml). */
export interface ProductNutrition {
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  fat: number | null;
  fiber: number | null;
  novaGroup: number | null;
}

export interface AddToInventoryPayload {
  barcode?: string;
  name: string;
  brand?: string | null;
  imageUrl?: string | null;
  nutriscore?: string | null;
  quantity: number;
  unit: 'g' | 'kg' | 'ml' | 'L' | 'unit';
  storageZoneId: string;
  expiryDate?: string | null;
  isShared: boolean;
  ownerId?: string | null;
  /** Macros OFF (pour 100 g) — persistées avec l'item */
  calories?: number | null;
  proteins?: number | null;
  carbohydrates?: number | null;
  fat?: number | null;
  fiber?: number | null;
  novaGroup?: number | null;
}

/** Réponse de GET /api/products/lookup/:barcode */
export interface ProductLookup {
  barcode: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  nutriscore: string | null;
  category: string | null;
}

// ── Recipes ───────────────────────────────────────────────────────────────────

export type MealSlot = 'LUNCH' | 'DINNER';

export interface GroceryLine {
  name: string;
  quantity: number;
  unit: string;
  estimated: boolean;
  sources: string[];
}

export interface CoveredGroceryLine extends GroceryLine {
  stockQuantity: number;
}

export interface GroceryConsolidation {
  startDate: string;
  endDate: string;
  mealsCount: number;
  servingsTotal: number;
  needed: GroceryLine[];
  covered: CoveredGroceryLine[];
  unresolvedRecipes: string[];
}

export interface GenerateGroceriesResult {
  addedItemsCount: number;
  coveredItemsCount: number;
  list: ShoppingList | null;
  consolidation: GroceryConsolidation;
}

export interface MealPlanEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  slot: MealSlot;
  recipeId: string;
  recipeName: string;
  cookId: string | null;
  /** Convives inscrits à table (null = toute la coloc) */
  attendeeIds?: string[] | null;
  /** Nombre de convives */
  servings?: number | null;
  cook: {
    id: string;
    name: string;
    colorHex: string;
    avatarUrl: string | null;
  } | null;
}

export interface MealPlanUpsertPayload {
  date: string;
  slot: MealSlot;
  recipeId: string;
  recipeName: string;
  cookId?: string | null;
}

/** Filtres du hub Recettes (transmis en query string). */
export interface RecipeQuery {
  search?: string;
  maxTime?: number;
  minProtein?: number;
  onlyAvailable?: boolean;
  onlyAlmost?: boolean;
  onlyFavorites?: boolean;
  limit?: number;
}

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
  /** Ingrédients effectivement trouvés en stock */
  usedIngredients?: string[];
  /** Ingrédients trouvés + zone 3D associée */
  usedIngredientRefs?: Array<{ name: string; meshId: string | null }>;
  totalIngredients?: number;
  likes?: number;
  readyInMinutes?: number;
  /** Protéines estimées par portion (g) — filtre « Riche en protéines » */
  proteinGrams?: number | null;
  /** Sprint 4 — hub Recettes */
  isFavorite?: boolean;
  isFullyAvailable?: boolean;
  isAlmostAvailable?: boolean;
  missingIngredientCount?: number;
  /** Bloc 1 — recette personnalisée importée par un colocataire */
  isCustom?: boolean;
  /** Bloc 1 — colocataires ayant liké la recette */
  favoritedByUsers?: Array<{ id: string; name: string; colorHex: string }>;
  /** Bloc 1 — ≥ 2 colocataires l'ont validée (badge 🔥 Match Coloc) */
  isColocMatch?: boolean;
}

// ── Recettes personnalisées (Bloc 1) ─────────────────────────────────────────

export interface CustomIngredient {
  name: string;
  quantity?: number | null;
  unit?: string | null;
}

export interface ScrapedIngredient extends CustomIngredient {
  inStock: boolean;
  matchedName: string | null;
}

export interface ScrapedRecipePreview {
  title: string;
  sourceUrl: string;
  imageUrl: string | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  servings: number;
  ingredients: ScrapedIngredient[];
  instructions: string[];
  stockSummary: { total: number; inStock: number; missing: number };
}

export interface CustomRecipe {
  id: string;
  title: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  servings: number;
  instructions: string[];
  ingredients: CustomIngredient[];
  createdAt: string;
  createdBy: { id: string; name: string; colorHex: string };
}

export interface CreateCustomRecipePayload {
  title: string;
  sourceUrl?: string | null;
  imageUrl?: string | null;
  prepTimeMin?: number | null;
  cookTimeMin?: number | null;
  servings?: number;
  instructions: string[];
  ingredients: CustomIngredient[];
}

// ── Nutrition : profil & cibles ───────────────────────────────────────────────

export type NutritionGoal = 'MAINTENANCE' | 'LEAN_BULK' | 'CUT' | 'HIGH_PROTEIN';

/** Profil du sélecteur « Qui cuisine aujourd'hui ? » (données publiques). */
export interface RoommateProfile {
  id: string;
  name: string;
  colorHex: string;
  avatarUrl: string | null;
  hasPin: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  colorHex: string;
  avatarUrl: string | null;
  birthDate: string | null;
  heightCm: number | null;
  weightKg: number | null;
  gender: 'M' | 'F' | null;
  activityLevel: number;
  nutritionGoal: NutritionGoal;
}

export interface NutritionTargets {
  bmr: number;
  tdee: number;
  targetCalories: number;
  targetProteins: number;
  goal: NutritionGoal;
  goalLabel: string;
  proteinPerKg: number;
  profile: {
    birthDate: string | null;
    age: number;
    heightCm: number | null;
    weightKg: number | null;
    gender: 'M' | 'F' | null;
    activityLevel: number;
    nutritionGoal: NutritionGoal;
  };
  /** `true` quand un champ biométrique manque (repli appliqué) */
  estimated: boolean;
  missingFields: string[];
}

export interface UpdateProfilePayload {
  birthDate?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  gender?: 'M' | 'F' | null;
  activityLevel?: number;
  nutritionGoal?: NutritionGoal;
}

// ── Navigation (extended) ─────────────────────────────────────────────────────

export type AppModule = 'fridge' | 'finance' | 'shopping' | 'scanner' | 'recipes';

// ── Aliments frais — ajout rapide sans code-barres (Sprint 3) ─────────────────

export type FreshCategoryId = 'butcher' | 'produce' | 'bakery';

export interface FreshCategory {
  id: FreshCategoryId;
  label: string;
  emoji: string;
}

export interface FreshPreset {
  id: string;
  name: string;
  category: FreshCategoryId;
  emoji: string;
  /** Durée de conservation sanitaire, en jours */
  shelfLifeDays: number;
  /** Zone de rangement recommandée (meshId StorageZone) */
  zoneMeshId: string;
  zoneLabel: string;
  unit: 'unit' | 'g' | 'kg' | 'ml' | 'L';
  defaultQty: number;
  /** Macros pour 100 g / 100 ml */
  calories: number | null;
  proteins: number | null;
  keywords: string[];
  /** `J+2`, `J+7`… calculé côté API */
  shelfLifeLabel: string;
  /** DLC proposée (YYYY-MM-DD) calculée côté API */
  defaultExpiryDate: string;
}

export interface FreshCatalog {
  categories: FreshCategory[];
  presets: FreshPreset[];
}

export interface QuickAddPayload {
  name?: string;
  presetId?: string;
  quantity?: number;
  unit?: FreshPreset['unit'];
  shelfLifeDays?: number;
  storageZoneId?: string;
  isShared?: boolean;
  /** Override manuel de la DLC (YYYY-MM-DD) */
  expiryDate?: string;
}

export interface QuickAddResult {
  item: {
    id: string;
    name: string;
    quantity: number;
    initialQuantity: number;
    unit: string;
    expiryDate: string | null;
    isShared: boolean;
    storageZoneLabel: string;
  };
  zoneId: string;
  zoneLabel: string;
  zoneMeshId: string;
  expiryDate: string;
  presetApplied: {
    id: string;
    name: string;
    shelfLifeDays: number;
    category: string;
  } | null;
}
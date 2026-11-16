import { useStore } from '@/store';
import type {
  ApiResponse, FridgeStateTwin, ZoneDetail,
  FinanceStatus, ShoppingList, AuthUser,
  ScannedProduct, AddToInventoryPayload, RecipeSuggestion, ProductLookup,
  UserProfile, NutritionTargets, UpdateProfilePayload,
  RoommateProfile,
  FreshCatalog, QuickAddPayload, QuickAddResult, StorageZoneSummary,
  AthleteProfile, AthleteGoal, NutritionToday, WeighIn, AuthMode, UpcomingWorkouts,
  WrappedWeekly, RecipeRecommendations, ShoppingPrediction,
  RecipeQuery, MealPlanEntry, MealPlanUpsertPayload,
  GenerateGroceriesResult,
  ScrapedRecipePreview, CustomRecipe, CreateCustomRecipePayload,
  LoggedMeal, LoggedMealPayload, MealDaySummary, MealDayHistory,
  RegisterPayload, AuthSession,
} from '@/types';

const BASE_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) ?? '/api';

/**
 * Routes d'authentification publiques : un 401 y signifie « identifiants
 * invalides », PAS « session expirée » — il ne doit donc pas déclencher le
 * logout global (sinon un mauvais PIN affiche « Session expirée »).
 */
const PUBLIC_AUTH_PATHS = [
  '/auth/request-invite',
  '/auth/login',
  '/auth/login-pin',
  '/auth/setup-pin',
  '/auth/register',
  '/auth/refresh',
];

class ApiClient {
  private getToken = () => useStore.getState().token;

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    };
    const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    const isPublicAuth = PUBLIC_AUTH_PATHS.some((publicPath) => path.startsWith(publicPath));
    if (response.status === 401 && !isPublicAuth) {
      useStore.getState().logout();
      throw new Error('Session expirée.');
    }
    const body = (await response.json()) as ApiResponse<T>;
    if (!response.ok || !body.success) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body.data as T;
  }

  // Inscription sur demande (approbation administrateur)
  requestInvite = (payload: { name: string; email: string }) =>
    this.request<null>('/auth/request-invite', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

  register = (payload: RegisterPayload) =>
    this.request<AuthSession>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

  // Fridge
  getFridgeState = () => this.request<FridgeStateTwin>('/fridge/state');
  getZoneDetail = (meshId: string) => this.request<ZoneDetail>(`/fridge/zones/${meshId}`);
  getZones = () => this.request<StorageZoneSummary[]>('/fridge/zones');

  // Profil athlète : biométrie, macros du jour, pesées, badge NFC
  updateSecurity = (payload: { username?: string | null; authMode?: AuthMode }) =>
    this.request<AuthUser>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  getAthleteProfile = () => this.request<AthleteProfile | null>('/profile');
  saveAthleteProfile = (payload: {
    heightCm: number;
    weightKg: number;
    birthDate: string;
    sex: 'M' | 'F';
    activityFactor: number;
    goal: AthleteGoal;
  }) =>
    this.request<AthleteProfile>('/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  getNutritionToday = () => this.request<NutritionToday>('/profile/nutrition/today');
  getWeighIns = (limit = 20) => this.request<WeighIn[]>(`/profile/weigh-ins?limit=${limit}`);
  getUpcomingWorkouts = () => this.request<UpcomingWorkouts>('/integrations/jarvis/upcoming');
  getWrapped = (offset = 0) => this.request<WrappedWeekly>(`/wrapped/weekly?offset=${offset}`);
  getRecipeRecommendations = () =>
    this.request<RecipeRecommendations>('/recipes/recommendations');
  getShoppingPredictions = () =>
    this.request<ShoppingPrediction[]>('/shopping/predictions');
  regenerateNfcBadge = () =>
    this.request<{ token: string; url: string }>('/auth/nfc/regenerate', { method: 'POST' });
  loginWithDevice = (userId: string) =>
    this.request<{ user: AuthUser; tokens: { accessToken: string; refreshToken: string } }>(
      '/auth/device',
      { method: 'POST', body: JSON.stringify({ userId }) },
    );

  // Auth
  login = (email: string, password: string) => this.request<{ user: AuthUser; tokens: { accessToken: string; refreshToken: string } }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  me = () => this.request<AuthUser>('/auth/me');
  getRoommates = () => this.request<AuthUser[]>('/auth/roommates');

  // Sélecteur de profils & code PIN (routes publiques)
  getProfiles = () => this.request<RoommateProfile[]>('/auth/profiles');
  loginWithPin = (userId: string, pin: string, username?: string) =>
    this.request<{ user: AuthUser; tokens: { accessToken: string; refreshToken: string; expiresIn: number } }>(
      '/auth/login-pin',
      { method: 'POST', body: JSON.stringify({ userId, pin, username }) },
    );
  setupPin = (userId: string, pin: string, email?: string, password?: string) =>
    this.request<{ user: AuthUser; tokens: { accessToken: string; refreshToken: string; expiresIn: number } }>(
      '/auth/setup-pin',
      {
        method: 'POST',
        body: JSON.stringify({
          userId,
          pin,
          ...(email ? { email } : {}),
          ...(password ? { password } : {}),
        }),
      },
    );

  // Profil nutritionnel & biométrie
  getProfile = () => this.request<UserProfile>('/users/me/profile');
  getNutritionTargets = () => this.request<NutritionTargets>('/users/me/nutrition-targets');
  updateProfile = (payload: UpdateProfilePayload) =>
    this.request<{ profile: UserProfile; targets: NutritionTargets }>('/users/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });

  // Products (OpenFoodFacts)
  lookupProduct = (barcode: string) =>
    this.request<ProductLookup>(`/products/lookup/${encodeURIComponent(barcode)}`);

  // Finance
  getFinanceStatus = () => this.request<FinanceStatus>('/finance/status');
  addExpense = (data: { description: string; amount: number; category: string; participantIds?: string[] }) =>
    this.request('/finance/expenses', { method: 'POST', body: JSON.stringify(data) });
  settleDebt = (toUserId: string, amount: number, note?: string) =>
    this.request('/finance/settle', { method: 'POST', body: JSON.stringify({ toUserId, amount, note }) });
  // Hybrid-Pay — pas de JWT, identification par badgeId (numéro de série NFC)
  // Le header X-Terminal-Secret est optionnel en dev, requis en prod (voir .env TERMINAL_SECRET)
  settleByNfc = (badgeId: string, toUserId: string, amount: number, note?: string) =>
    this.request('/finance/settle-nfc', {
      method: 'POST',
      headers: {
        'X-Terminal-Secret': (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TERMINAL_SECRET) ?? '',
      },
      body: JSON.stringify({ badgeId, toUserId, amount, note }),
    });

  // Shopping
  // `GET /shopping/lists/active` renvoie la liste active (objet) ; on tolère
  // aussi l'ancien format tableau pour rester compatible.
  getShoppingList = () =>
    this.request<ShoppingList | ShoppingList[]>('/shopping/lists/active').then((data) =>
      Array.isArray(data) ? data[0] ?? null : data,
    );
  addShoppingItem = (listId: string, data: { name: string; quantity: number; unit: string }) =>
    this.request(`/shopping/lists/${listId}/items`, { method: 'POST', body: JSON.stringify(data) });
  checkItem = (listId: string, itemId: string) =>
    this.request(`/shopping/lists/${listId}/items/${itemId}/check`, { method: 'PATCH' });
  deleteShoppingItem = (listId: string, itemId: string) =>
    this.request(`/shopping/lists/${listId}/items/${itemId}`, { method: 'DELETE' });

  /**
   * Pont Recettes → Courses : ajoute en un appel tous les ingrédients manquants
   * à la liste active. Le backend déduplique les articles déjà en attente et
   * renvoie la liste complète (utilisée pour rafraîchir le store).
   */
  addMissingIngredientsToShopping = (
    items: Array<{ name: string; quantity?: number; unit?: string }>,
  ) =>
    this.request<ShoppingList>('/shopping/lists/active/items/batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  // Notifications (Web Push)
  getPushPublicKey = () =>
    this.request<{ publicKey: string | null; configured: boolean }>('/notifications/public-key');
  getPushServerStatus = () =>
    this.request<{ configured: boolean; subscriptions: number }>('/notifications/status');
  subscribePush = (subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }) =>
    this.request('/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    });
  unsubscribePush = (endpoint: string) =>
    this.request('/notifications/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    });
  sendTestPush = (itemId?: string) =>
    this.request('/notifications/test', {
      method: 'POST',
      body: JSON.stringify(itemId ? { itemId } : {}),
    });

  // Scanner
  scanBarcode = (barcode: string) =>
    this.request<ScannedProduct>('/inventory/scan', { method: 'POST', body: JSON.stringify({ barcode }) });

  // Inventory
  addToInventory = (data: AddToInventoryPayload) =>
    this.request('/inventory/items', { method: 'POST', body: JSON.stringify(data) });

  /**
   * Consommation progressive (Sprint 2) : décrémente `amount` et renvoie la
   * quantité restante, utilisée par la jauge du tooltip 3D.
   */
  consumeItemPart = (id: string, amount: number) =>
    this.request<{
      item: { id: string; name: string; quantity: number; initialQuantity: number; unit: string };
      isFullyConsumed: boolean;
      remainingQuantity: number;
      addedToShoppingList: boolean;
    }>(`/inventory/items/${id}/consume-part`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });

  consumeItem = async (id: string, quantity = 1): Promise<void> => {
    await this.request(`/inventory/items/${id}/consume`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    });
  };
  /** Suppression définitive d'un item (consommation totale explicite). */
  deleteItem = async (id: string): Promise<void> => {
    await this.request(`/inventory/items/${id}`, { method: 'DELETE' });
  };
  getStorageZones = () =>
    this.request<Array<{ id: string; meshId: string; label: string; type: string }>>('/fridge/zones');

  // ── Aliments frais (Sprint 3) ──────────────────────────────────────────────
  /** Catalogue des presets frais (boucherie, primeur, boulangerie). */
  getFreshPresets = () => this.request<FreshCatalog>('/inventory/presets');

  /** Ajout rapide sans code-barres (preset ou nom libre). */
  quickAddItem = (payload: QuickAddPayload) =>
    this.request<QuickAddResult>('/inventory/items/quick-add', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

  // Recipes
  getRecipeSuggestions = async (
    query: RecipeQuery | number = 8,
  ): Promise<RecipeSuggestion[]> => {
    const params = new URLSearchParams();
    if (typeof query === 'number') {
      params.set('limit', String(query));
    } else {
      if (query.search) params.set('search', query.search);
      if (query.maxTime !== undefined) params.set('maxTime', String(query.maxTime));
      if (query.minProtein !== undefined) params.set('minProtein', String(query.minProtein));
      if (query.onlyAvailable) params.set('onlyAvailable', 'true');
      if (query.onlyAlmost) params.set('onlyAlmost', 'true');
      if (query.onlyFavorites) params.set('onlyFavorites', 'true');
      params.set('limit', String(query.limit ?? 50));
    }
    const response = await this.request<{ suggestions?: RecipeSuggestion[] }>(
      `/recipes/suggest?${params.toString()}`,
    );
    return response.suggestions ?? [];
  };
  toggleFavoriteRecipe = (recipeId: string) =>
    this.request<{ isFavorite: boolean }>(`/recipes/${recipeId}/favorite`, { method: 'POST' });

  // ── Bloc 1 : import par URL & recettes personnalisées ─────────────────────
  /** Scrape une page (JSON-LD) et renvoie une prévisualisation non persistée. */
  extractRecipeFromUrl = (url: string) =>
    this.request<ScrapedRecipePreview>('/recipes/extract-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });

  getCustomRecipes = () => this.request<CustomRecipe[]>('/recipes/custom');

  createCustomRecipe = (payload: CreateCustomRecipePayload) =>
    this.request<CustomRecipe>('/recipes/custom', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

  deleteCustomRecipe = (id: string) =>
    this.request<{ deleted: boolean }>(`/recipes/custom/${id}`, { method: 'DELETE' });

  // ── Semainier (Sprint 4) ───────────────────────────────────────────────────
  getMealPlan = async (start: string, end: string): Promise<MealPlanEntry[]> => {
    const response = await this.request<{ meals?: MealPlanEntry[] }>(
      `/meal-plan?start=${start}&end=${end}`,
    );
    return response.meals ?? [];
  };
  upsertMealPlan = (payload: MealPlanUpsertPayload) =>
    this.request<MealPlanEntry>('/meal-plan', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  deleteMealPlan = (id: string) =>
    this.request<{ deleted: boolean }>(`/meal-plan/${id}`, { method: 'DELETE' });

  // ── Journal nutritionnel (repas enregistrés) ──────────────────────────────
  createMeal = (payload: LoggedMealPayload) =>
    this.request<LoggedMeal>('/meals', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  getMealsToday = (date?: string) =>
    this.request<MealDaySummary>(`/meals/today${date ? `?date=${date}` : ''}`);
  getMealsHistory = (days = 7) =>
    this.request<MealDayHistory[]>(`/meals/history?days=${days}`);

  /** Bloc 2 — convives d'un créneau (ajuste aussi les portions). */
  updateMealPlanAttendees = (id: string, attendeeIds: string[]) =>
    this.request<MealPlanEntry>(`/meal-plan/${id}/attendees`, {
      method: 'PATCH',
      body: JSON.stringify({ attendeeIds }),
    });

  /** Bloc 2 — consolidation des courses (`dryRun` = prévisualisation). */
  generateWeeklyGroceries = (startDate: string, endDate: string, dryRun = false) =>
    this.request<GenerateGroceriesResult>('/meal-plan/generate-groceries', {
      method: 'POST',
      body: JSON.stringify({ startDate, endDate, dryRun }),
    });
}

export const api = new ApiClient();
import { useStore } from '@/store';
import type {
  ApiResponse, FridgeStateTwin, ZoneDetail,
  FinanceStatus, ShoppingList, AuthUser,
  ScannedProduct, AddToInventoryPayload, RecipeSuggestion, ProductLookup,
  UserProfile, NutritionTargets, UpdateProfilePayload,
} from '@/types';

const BASE_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) ?? '/api';

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
    if (response.status === 401) { useStore.getState().logout(); throw new Error('Session expirée.'); }
    const body = (await response.json()) as ApiResponse<T>;
    if (!response.ok || !body.success) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body.data as T;
  }

  // Fridge
  getFridgeState = () => this.request<FridgeStateTwin>('/fridge/state');
  getZoneDetail = (meshId: string) => this.request<ZoneDetail>(`/fridge/zones/${meshId}`);

  // Auth
  login = (email: string, password: string) => this.request<{ user: AuthUser; tokens: { accessToken: string; refreshToken: string } }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  me = () => this.request<AuthUser>('/auth/me');
  getRoommates = () => this.request<AuthUser[]>('/auth/roommates');

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

  // Recipes
  getRecipeSuggestions = async (limit = 8): Promise<RecipeSuggestion[]> => {
    const response = await this.request<{ suggestions?: RecipeSuggestion[] }>(
      `/recipes/suggest?limit=${limit}`,
    );
    return response.suggestions ?? [];
  };
  toggleFavoriteRecipe = (recipeId: string) =>
    this.request<{ isFavorite: boolean }>(`/recipes/${recipeId}/favorite`, { method: 'POST' });
}

export const api = new ApiClient();
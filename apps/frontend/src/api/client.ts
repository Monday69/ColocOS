import { useStore } from '@/store';
import type {
  ApiResponse, FridgeStateTwin, ZoneDetail,
  FinanceStatus, ShoppingList, AuthUser,
  ScannedProduct, AddToInventoryPayload, RecipeSuggestion,
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
  getShoppingList = () => this.request<ShoppingList[]>('/shopping/lists/active').then(lists => lists[0] ?? null);
  addShoppingItem = (listId: string, data: { name: string; quantity: number; unit: string }) =>
    this.request(`/shopping/lists/${listId}/items`, { method: 'POST', body: JSON.stringify(data) });
  checkItem = (listId: string, itemId: string) =>
    this.request(`/shopping/lists/${listId}/items/${itemId}/check`, { method: 'PATCH' });
  deleteItem = (listId: string, itemId: string) =>
    this.request(`/shopping/lists/${listId}/items/${itemId}`, { method: 'DELETE' });
  // Scanner
  scanBarcode = (barcode: string) =>
    this.request<ScannedProduct>('/inventory/scan', { method: 'POST', body: JSON.stringify({ barcode }) });

  // Inventory
  addToInventory = (data: AddToInventoryPayload) =>
    this.request('/inventory/items', { method: 'POST', body: JSON.stringify(data) });
  getStorageZones = () =>
    this.request<Array<{ id: string; meshId: string; label: string; type: string }>>('/inventory/zones');

  // Recipes
  getRecipeSuggestions = (limit = 8) =>
    this.request<RecipeSuggestion[]>(`/recipes/suggest?limit=${limit}`);
  toggleFavoriteRecipe = (recipeId: string) =>
    this.request<{ isFavorite: boolean }>(`/recipes/${recipeId}/favorite`, { method: 'POST' });
}

export const api = new ApiClient();
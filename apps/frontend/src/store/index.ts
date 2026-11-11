import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type {
  AuthUser, FridgeStateTwin, ZoneDetail,
  FinanceStatus, ShoppingList, AppModule,
  ScannedProduct, RecipeSuggestion,
} from '@/types';
import { api } from '@/api/client';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Global Store v3 (Sprint 8 — Offline + Audio)
//
// Nouveaux slices : Connectivity · Audio · OfflineQueue
//
// Stratégie partialize (localStorage) :
//   auth · shoppingList · offlineCheckQueue · isMuted
// ─────────────────────────────────────────────────────────────────────────────

export interface OfflineCheckAction {
  listId: string;
  itemId: string;
  checkedAt: number;
}

type ColocOSStore = {
  token: string | null; refreshToken: string | null; user: AuthUser | null; isAuthenticated: boolean;
  setAuth: (token: string, refreshToken: string, user: AuthUser) => void;
  logout: () => void;
  fridgeState: FridgeStateTwin | null; lastFetchedAt: Date | null; isLoading: boolean; error: string | null;
  setFridgeState: (state: FridgeStateTwin) => void;
  setFridgeLoading: (loading: boolean) => void;
  setFridgeError: (error: string | null) => void;
  selectedMeshId: string | null; hoveredMeshId: string | null; zoneDetail: ZoneDetail | null;
  isPanelOpen: boolean; isDetailLoading: boolean;
  /** Item 3D sélectionné (clic sur un packaging) — pilote le tooltip produit */
  selectedItemId: string | null;
  setSelectedItemId: (itemId: string | null) => void;
  /** Intro cinématique de la scène 3D : fige les contrôles et voile l'UI */
  isIntroActive: boolean;
  setIntroActive: (active: boolean) => void;
  setSelectedMesh: (meshId: string | null) => void;
  setHoveredMesh: (meshId: string | null) => void;
  setZoneDetail: (detail: ZoneDetail | null) => void;
  setPanelOpen: (open: boolean) => void;
  setDetailLoading: (loading: boolean) => void;
  activeModule: AppModule; setActiveModule: (module: AppModule) => void;
  isDoorOpen: boolean; setDoorOpen: (open: boolean) => void;
  financeStatus: FinanceStatus | null; isFinanceLoading: boolean; financeError: string | null;
  settleModal: { open: boolean; toUserId: string; toName: string; toColorHex: string; maxAmount: number } | null;
  setFinanceStatus: (status: FinanceStatus) => void;
  setFinanceLoading: (loading: boolean) => void;
  setFinanceError: (error: string | null) => void;
  openSettleModal: (toUserId: string, toName: string, toColorHex: string, maxAmount: number) => void;
  closeSettleModal: () => void;
  shoppingList: ShoppingList | null; isShoppingLoading: boolean; shoppingError: string | null;
  setShoppingList: (list: ShoppingList) => void;
  setShoppingLoading: (loading: boolean) => void;
  setShoppingError: (error: string | null) => void;
  highlightedOwnerColor: string | null; setHighlightedOwnerColor: (color: string | null) => void;
  highlightedMeshIds: string[]; setHighlightedMeshIds: (ids: string[]) => void;
  scannedProduct: ScannedProduct | null; isScanLoading: boolean; scanError: string | null;
  setScannedProduct: (p: ScannedProduct | null) => void;
  setScanLoading: (v: boolean) => void; setScanError: (e: string | null) => void;
  recipeSuggestions: RecipeSuggestion[]; isRecipesLoading: boolean; recipesError: string | null;
  setRecipeSuggestions: (r: RecipeSuggestion[]) => void;
  setRecipesLoading: (v: boolean) => void; setRecipesError: (e: string | null) => void;
  // Connectivity
  isOnline: boolean; setOnline: (online: boolean) => void;
  // Audio
  isMuted: boolean; setMuted: (muted: boolean) => void;
  // Offline Queue
  offlineCheckQueue: OfflineCheckAction[];
  enqueueCheck: (listId: string, itemId: string) => void;
  clearOfflineQueue: () => void;
  syncOfflineQueue: () => Promise<void>;
};

export const useStore = create<ColocOSStore>()(
  devtools(
    persist(
      (set, get) => ({
        token: null, refreshToken: null, user: null, isAuthenticated: false,
        setAuth: (token, refreshToken, user) => set({ token, refreshToken, user, isAuthenticated: true }, false, 'auth/setAuth'),
        logout: () => set({ token: null, refreshToken: null, user: null, isAuthenticated: false }, false, 'auth/logout'),
        fridgeState: null, lastFetchedAt: null, isLoading: false, error: null,
        setFridgeState: (state) => set((s) => {
          // Un item consommé/supprimé disparaît de l'état : on referme le
          // tooltip associé pour ne jamais laisser d'infobulle orpheline.
          const stillThere =
            s.selectedItemId !== null &&
            Object.values(state.zones).some((zone) =>
              zone.items.some((item) => item.id === s.selectedItemId),
            );
          return {
            fridgeState: state,
            lastFetchedAt: new Date(),
            error: null,
            selectedItemId: stillThere ? s.selectedItemId : null,
          };
        }, false, 'fridge/setState'),
        setFridgeLoading: (loading) => set({ isLoading: loading }, false, 'fridge/setLoading'),
        setFridgeError: (error) => set({ error, isLoading: false }, false, 'fridge/setError'),
        selectedMeshId: null, hoveredMeshId: null, zoneDetail: null, isPanelOpen: false, isDetailLoading: false,
        selectedItemId: null,
        setSelectedItemId: (itemId) => set({ selectedItemId: itemId }, false, 'ui/setSelectedItemId'),
        isIntroActive: true,
        setIntroActive: (active) => set({ isIntroActive: active }, false, 'ui/setIntroActive'),
        // Changer de zone ferme le tooltip produit (le mesh n'est plus à l'écran)
        setSelectedMesh: (meshId) => set({ selectedMeshId: meshId, selectedItemId: null }, false, 'ui/setSelectedMesh'),
        setHoveredMesh: (meshId) => set({ hoveredMeshId: meshId }, false, 'ui/setHoveredMesh'),
        setZoneDetail: (detail) => set({ zoneDetail: detail }, false, 'ui/setZoneDetail'),
        setPanelOpen: (open) => set({ isPanelOpen: open }, false, 'ui/setPanelOpen'),
        setDetailLoading: (loading) => set({ isDetailLoading: loading }, false, 'ui/setDetailLoading'),
        activeModule: 'fridge',
        setActiveModule: (module) => set({ activeModule: module }, false, 'nav/setModule'),
        isDoorOpen: false,
        setDoorOpen: (open) => set({ isDoorOpen: open }, false, 'nav/setDoorOpen'),
        financeStatus: null, isFinanceLoading: false, financeError: null, settleModal: null,
        setFinanceStatus: (status) => set({ financeStatus: status, isFinanceLoading: false, financeError: null }, false, 'finance/setStatus'),
        setFinanceLoading: (loading) => set({ isFinanceLoading: loading }, false, 'finance/setLoading'),
        setFinanceError: (error) => set({ financeError: error, isFinanceLoading: false }, false, 'finance/setError'),
        openSettleModal: (toUserId, toName, toColorHex, maxAmount) =>
          set({ settleModal: { open: true, toUserId, toName, toColorHex, maxAmount } }, false, 'finance/openModal'),
        closeSettleModal: () => set({ settleModal: null }, false, 'finance/closeModal'),
        shoppingList: null, isShoppingLoading: false, shoppingError: null,
        setShoppingList: (list) => set({ shoppingList: list, isShoppingLoading: false, shoppingError: null }, false, 'shopping/setList'),
        setShoppingLoading: (loading) => set({ isShoppingLoading: loading }, false, 'shopping/setLoading'),
        setShoppingError: (error) => set({ shoppingError: error, isShoppingLoading: false }, false, 'shopping/setError'),
        highlightedOwnerColor: null,
        setHighlightedOwnerColor: (color) => set({ highlightedOwnerColor: color }, false, 'bridge/setOwnerColor'),
        highlightedMeshIds: [],
        setHighlightedMeshIds: (ids) => set({ highlightedMeshIds: ids }, false, 'bridge/setMeshIds'),
        scannedProduct: null, isScanLoading: false, scanError: null,
        setScannedProduct: (p) => set({ scannedProduct: p, isScanLoading: false }, false, 'scanner/setProduct'),
        setScanLoading: (v) => set({ isScanLoading: v }, false, 'scanner/setLoading'),
        setScanError: (e) => set({ scanError: e, isScanLoading: false }, false, 'scanner/setError'),
        recipeSuggestions: [], isRecipesLoading: false, recipesError: null,
        setRecipeSuggestions: (r) => set({ recipeSuggestions: r, isRecipesLoading: false }, false, 'recipes/setSuggestions'),
        setRecipesLoading: (v) => set({ isRecipesLoading: v }, false, 'recipes/setLoading'),
        setRecipesError: (e) => set({ recipesError: e, isRecipesLoading: false }, false, 'recipes/setError'),
        // Connectivity
        isOnline: true,
        setOnline: (online) => set({ isOnline: online }, false, 'connectivity/setOnline'),
        // Audio
        isMuted: false,
        setMuted: (muted) => set({ isMuted: muted }, false, 'audio/setMuted'),
        // Offline Queue
        offlineCheckQueue: [],
        enqueueCheck: (listId, itemId) => {
          const q = get().offlineCheckQueue;
          if (q.some(a => a.itemId === itemId)) return;
          set({ offlineCheckQueue: [...q, { listId, itemId, checkedAt: Date.now() }] }, false, 'offline/enqueue');
        },
        clearOfflineQueue: () => set({ offlineCheckQueue: [] }, false, 'offline/clear'),
        syncOfflineQueue: async () => {
          const { offlineCheckQueue, setShoppingList, clearOfflineQueue } = get();
          if (offlineCheckQueue.length === 0) return;
          console.log(`[Offline] Syncing ${offlineCheckQueue.length} check(s)…`);
          const results = await Promise.allSettled(
            offlineCheckQueue.map(a => api.checkItem(a.listId, a.itemId)),
          );
          const failed = results.filter(r => r.status === 'rejected').length;
          if (failed < offlineCheckQueue.length) {
            clearOfflineQueue();
            try {
              const fresh = await api.getShoppingList();
              if (fresh) setShoppingList(fresh);
            } catch { /* keep local */ }
          }
          console.log(`[Offline] ${offlineCheckQueue.length - failed} synced, ${failed} failed`);
        },
      }),
      {
        name: 'colocos-store',
        partialize: (s) => ({
          token: s.token,
          refreshToken: s.refreshToken,
          user: s.user,
          isAuthenticated: s.isAuthenticated,
          shoppingList: s.shoppingList,
          offlineCheckQueue: s.offlineCheckQueue,
          isMuted: s.isMuted,
        }),
      },
    ),
    { name: 'ColocOS' },
  ),
);

export { useStore as useAuth };
export { useStore as useFridgeStore };
export { useStore as useUIStore };
export { useStore as useNavStore };
export { useStore as useFinanceStore };
export { useStore as useShoppingStore };
export { useStore as useBridge };
export { useStore as useScannerStore };
export { useStore as useRecipesStore };
export { useStore as useConnectivityStore };
export { useStore as useAudioStore };
export { useStore as useOfflineQueue };
import { useEffect, useCallback } from 'react';
import { api } from '@/api/client';
import { useShoppingStore, useAuth, useOfflineQueue, useConnectivityStore } from '@/store';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — useShopping v2 (Sprint 8 — Offline Queue)
//
// Stratégie :
//   online  → checkItem appelle l'API directement
//   offline → update optimiste local + enqueue dans offlineCheckQueue (persisté)
//             → synchro automatique quand le réseau revient (via useConnectivity)
//   addItem → réseau requis (impossibilité de générer un ID local fiable)
// ─────────────────────────────────────────────────────────────────────────────

export function useShopping() {
  const { isAuthenticated } = useAuth();
  const { isOnline } = useConnectivityStore();
  const {
    shoppingList, isShoppingLoading, shoppingError,
    setShoppingList, setShoppingLoading, setShoppingError,
  } = useShoppingStore();
  const { enqueueCheck } = useOfflineQueue();

  const fetch = useCallback(async () => {
    if (!isOnline) {
      setShoppingLoading(false);
      return; // Garde la liste persistée du localStorage
    }
    setShoppingLoading(true);
    try {
      const list = await api.getShoppingList();
      if (list) setShoppingList(list);
    } catch (err) {
      setShoppingError(err instanceof Error ? err.message : 'Erreur réseau');
    }
  }, [isOnline, setShoppingList, setShoppingLoading, setShoppingError]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch();
  }, [isAuthenticated, fetch]);

  const checkItem = useCallback(async (itemId: string) => {
    if (!shoppingList) return;

    // Optimistic update immédiat — fonctionne online ET offline
    setShoppingList({
      ...shoppingList,
      items: shoppingList.items.map(i =>
        i.id === itemId ? { ...i, status: 'checked' as const } : i,
      ),
    });

    if (!isOnline) {
      enqueueCheck(shoppingList.id, itemId);
      return;
    }

    try {
      await api.checkItem(shoppingList.id, itemId);
    } catch {
      // Rollback si l'API échoue en ligne
      setShoppingList({
        ...shoppingList,
        items: shoppingList.items.map(i =>
          i.id === itemId ? { ...i, status: 'pending' as const } : i,
        ),
      });
    }
  }, [shoppingList, setShoppingList, isOnline, enqueueCheck]);

  const addItem = useCallback(async (name: string, quantity: number, unit: string) => {
    if (!shoppingList) return;
    if (!isOnline) throw new Error("Impossible d'ajouter un article hors-ligne");
    await api.addShoppingItem(shoppingList.id, { name, quantity, unit });
    await fetch();
  }, [shoppingList, isOnline, fetch]);

  return { shoppingList, isShoppingLoading, shoppingError, checkItem, addItem, refresh: fetch, isOffline: !isOnline };
}
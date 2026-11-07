import { useEffect, useCallback, useRef } from 'react';
import { api } from '@/api/client';
import { useFridgeStore, useAuth } from '@/store';

const POLL_INTERVAL_MS = 30_000;

export function useFridgeState() {
  // On récupère les données sans sélecteur pour éviter l'erreur "0 arguments"
  // tout en restant vigilant sur la boucle infinie.
  const auth = useAuth() as any;
  const isAuthenticated = auth.isAuthenticated;

  const store = useFridgeStore() as any;
  const { 
    setFridgeState, setFridgeLoading, setFridgeError, 
    fridgeState, isLoading, error 
  } = store;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const fetchState = useCallback(async () => {
    if (!isMountedRef.current || !isAuthenticated) return;

    try {
      setFridgeLoading(true);
      const state = await api.getFridgeState();
      if (isMountedRef.current) {
        setFridgeState(state);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        const message = err?.message || 'Erreur inconnue';
        setFridgeError(message);
      }
    } finally {
      if (isMountedRef.current) setFridgeLoading(false);
    }
  }, [isAuthenticated, setFridgeState, setFridgeLoading, setFridgeError]);

  useEffect(() => {
    isMountedRef.current = true;
    if (!isAuthenticated) return;

    fetchState();
    intervalRef.current = setInterval(fetchState, POLL_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isAuthenticated, fetchState]);

  return { fridgeState, isLoading, error, refresh: fetchState };
}
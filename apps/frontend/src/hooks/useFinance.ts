import { useEffect, useCallback } from 'react';
import { api } from '@/api/client';
import { useFinanceStore, useAuth } from '@/store';

export function useFinance() {
  const { isAuthenticated } = useAuth();
  const { financeStatus, isFinanceLoading, financeError, setFinanceStatus, setFinanceLoading, setFinanceError } = useFinanceStore();

  const fetch = useCallback(async () => {
    setFinanceLoading(true);
    try {
      const status = await api.getFinanceStatus();
      setFinanceStatus(status);
    } catch (err) {
      setFinanceError(err instanceof Error ? err.message : 'Erreur');
    }
  }, [setFinanceStatus, setFinanceLoading, setFinanceError]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch();
    const id = setInterval(fetch, 60_000);
    return () => clearInterval(id);
  }, [isAuthenticated, fetch]);

  return { financeStatus, isFinanceLoading, financeError, refresh: fetch };
}
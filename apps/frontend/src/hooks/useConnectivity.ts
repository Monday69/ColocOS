import { useEffect } from 'react';
import { useStore } from '@/store';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — useConnectivity Hook
//
// Écoute les événements browser `online` / `offline` et synchronise l'état
// dans le store Zustand.
//
// Le hook expose aussi `isOnline` pour les composants qui veulent réagir
// sans passer par le store (lecture directe depuis `navigator.onLine`).
//
// Usage :
//   // Dans App.tsx (une seule fois, montage global)
//   useConnectivity();
//
//   // Dans n'importe quel composant
//   const { isOnline } = useStore(s => ({ isOnline: s.isOnline }));
// ─────────────────────────────────────────────────────────────────────────────

export function useConnectivity() {
  const setOnline = useStore(s => s.setOnline);
  const syncOfflineQueue = useStore(s => s.syncOfflineQueue);

  useEffect(() => {
    // Initialise avec l'état réel du navigateur (au cas où le composant
    // se monte alors que la connexion est déjà perdue)
    setOnline(navigator.onLine);

    const handleOnline = () => {
      setOnline(true);
      // Déclenche la synchronisation de la queue dès que le réseau revient
      syncOfflineQueue();
    };

    const handleOffline = () => {
      setOnline(false);
    };

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline, syncOfflineQueue]);
}

// Hook léger pour les composants qui veulent juste lire isOnline
export function useIsOnline(): boolean {
  return useStore(s => s.isOnline);
}
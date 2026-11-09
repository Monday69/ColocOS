import { useCallback } from 'react';
import { api } from '@/api/client';
import { useUIStore } from '@/store';
import { toasts } from '@/components/ui/ToastProvider';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — useZoneDetail hook
// Déclenché au clic sur un mesh — charge le panneau latéral
// ─────────────────────────────────────────────────────────────────────────────

export function useZoneDetail() {
  const {
    zoneDetail,
    isPanelOpen,
    isDetailLoading,
    setSelectedMesh,
    setZoneDetail,
    setPanelOpen,
    setDetailLoading,
  } = useUIStore();

  const openZone = useCallback(
    async (meshId: string) => {
      console.log(`[Digital Twin] Zone cliquée : ${meshId}`);

      setSelectedMesh(meshId);
      setPanelOpen(true);
      setDetailLoading(true);
      setZoneDetail(null);

      try {
        const detail = await api.getZoneDetail(meshId);
        setZoneDetail(detail);
      } catch (err) {
        console.error('[useZoneDetail] Échec chargement zone:', err);
        toasts.error(
          'Zone indisponible',
          err instanceof Error ? err.message : `Impossible de charger ${meshId}`,
        );
        setZoneDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [setSelectedMesh, setPanelOpen, setDetailLoading, setZoneDetail],
  );

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setSelectedMesh(null);
    setZoneDetail(null);
  }, [setPanelOpen, setSelectedMesh, setZoneDetail]);

  return { zoneDetail, isPanelOpen, isDetailLoading, openZone, closePanel };
}